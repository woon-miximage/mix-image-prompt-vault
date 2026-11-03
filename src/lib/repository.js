import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from './firebase'

const COLLECTION = 'prompts'
const FOLDERS_COLLECTION = 'prompt_folders'
const SAVINGS_COLLECTION = 'savings_transactions'
const LOCAL_KEY = 'mix-image-prompt-vault.local.v1'
const LOCAL_FOLDERS_KEY = 'mix-image-prompt-vault.folders.v1'
const LOCAL_SAVINGS_KEY = 'mix-image-prompt-vault.savings.v1'

const asDateValue = (value) => {
  if (!value) return new Date().toISOString()
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return value
}

export const normalizePrompt = (id, data = {}) => ({
  id,
  title: data.title || 'พรอมต์ไม่มีชื่อ',
  promptText: data.promptText || data.prompt || '',
  negativePrompt: data.negativePrompt || data.negative_prompt || '',
  category: data.category || data.page || 'main',
  folder: (data.folder || '').trim(),
  sortOrder:
    typeof data.sort_order === 'number'
      ? data.sort_order
      : typeof data.sortOrder === 'number'
      ? data.sortOrder
      : null,
  tags: Array.isArray(data.tags) ? data.tags : [],
  notes: data.notes || '',
  tool: data.tool || '',
  imageUrls: Array.isArray(data.image_urls)
    ? data.image_urls.filter(Boolean).slice(0, 4)
    : [data.image_url || data.image].filter(Boolean).slice(0, 4),
  imagePath: data.image_path || data.imagePath || '',
  favorite: Boolean(data.favorite ?? data.pinned),
  createdAt: asDateValue(data.created_at || data.createdAt),
  updatedAt: asDateValue(data.updated_at || data.updatedAt || data.created_at),
})

export const sortPrompts = (items = []) =>
  [...items].sort((a, b) => {
    const aHasOrder = typeof a.sortOrder === 'number' && !Number.isNaN(a.sortOrder)
    const bHasOrder = typeof b.sortOrder === 'number' && !Number.isNaN(b.sortOrder)
    if (aHasOrder && bHasOrder && a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder
    }
    if (aHasOrder && !bHasOrder) return -1
    if (!aHasOrder && bHasOrder) return 1
    return new Date(b.updatedAt) - new Date(a.updatedAt)
  })

export const readLocalPrompts = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
    return Array.isArray(parsed)
      ? sortPrompts(parsed.map((item) => normalizePrompt(item.id, item)))
      : []
  } catch {
    return []
  }
}

export const writeLocalPrompts = (items) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items))
  } catch {
    // Ignore localStorage quota errors when cloud is primary
  }
}

export const readLocalFolders = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_FOLDERS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const writeLocalFolders = (folders) => {
  try {
    localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(folders))
  } catch {
    // Ignore storage errors
  }
}

export const loadCloudFolders = async () => {
  try {
    const fetchOp = getDocs(collection(db, FOLDERS_COLLECTION)).then((snapshot) =>
      snapshot.docs
        .map((item) => {
          const d = item.data()
          return {
            id: item.id,
            name: (d.name || '').trim(),
            category: d.category || 'all',
            createdAt: asDateValue(d.created_at || d.createdAt),
          }
        })
        .filter((f) => f.name)
    )
    const timeoutOp = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cloud folders timeout')), 4500)
    )
    return await Promise.race([fetchOp, timeoutOp])
  } catch {
    return readLocalFolders()
  }
}

export const saveCloudFolder = async ({ name, category = 'all' }) => {
  const cleanName = (name || '').trim()
  const nowIso = new Date().toISOString()
  try {
    const addOp = addDoc(collection(db, FOLDERS_COLLECTION), {
      name: cleanName,
      category,
      created_at: serverTimestamp(),
    }).then((created) => ({
      id: created.id,
      name: cleanName,
      category,
      createdAt: nowIso,
    }))
    const timeoutOp = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Save cloud folder timeout')), 4000)
    )
    return await Promise.race([addOp, timeoutOp])
  } catch {
    return { id: `folder-${Date.now()}`, name: cleanName, category, createdAt: nowIso }
  }
}

export const deleteCloudFolder = async (folderId) => {
  if (
    !folderId ||
    String(folderId).startsWith('folder-') ||
    String(folderId).startsWith('derived-')
  ) {
    return
  }
  try {
    await deleteDoc(doc(db, FOLDERS_COLLECTION, folderId))
  } catch {
    // Ignore if offline or local folder
  }
}

export const fileToLocalPreview = (file, maxSide = 760) => new Promise((resolve, reject) => {
  if (!file || !file.type?.startsWith('image/')) {
    reject(new Error('ไฟล์นี้ไม่ใช่ภาพที่รองรับ'))
    return
  }
  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl)
    reject(new Error('ไฟล์นี้ไม่ใช่ภาพที่รองรับ'))
  }
  image.onload = () => {
    try {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.78))
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }
  image.src = objectUrl
})

export const loadCloudPrompts = async () => {
  const snapshot = await getDocs(collection(db, COLLECTION))
  return sortPrompts(
    snapshot.docs.map((item) => normalizePrompt(item.id, item.data()))
  )
}

export const compressImageFile = (file, maxSide = 960, quality = 0.8) => new Promise((resolve, reject) => {
  if (!file || !file.type?.startsWith('image/')) {
    resolve(file)
    return
  }
  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl)
    reject(new Error('ไฟล์นี้ไม่ใช่ภาพที่รองรับ'))
  }
  image.onload = () => {
    const maxDim = Math.max(image.naturalWidth, image.naturalHeight)
    const scale = maxDim > maxSide ? maxSide / maxDim : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(objectUrl)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(file)
          return
        }
        const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        })
        resolve(compressed)
      },
      'image/jpeg',
      quality
    )
  }
  image.src = objectUrl
})

const safeFileName = (name = 'image') => name.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80)

// จดจำสถานะว่า Firebase Storage เปิดใช้งานอยู่หรือไม่ เพื่อไม่ให้เสียเวลารอ Timeout ซ้ำทุกครั้งที่กดบันทึก
let storageBucketReady = false

const uploadPromptImage = async (file, precompressedPreview = '') => {
  // ใช้ภาพที่บีบอัดไว้แล้วทันที หรือบีบอัดใหม่ความเร็วสูง (~25-45KB)
  const localPreview = precompressedPreview || (await fileToLocalPreview(file, 760).catch(() => ''))

  if (!storageBucketReady) {
    return { url: localPreview, path: '' }
  }

  try {
    const optimized = await compressImageFile(file, 960, 0.8).catch(() => file)
    const path = `prompt-images/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`
    const storageRef = ref(storage, path)

    const uploadPromise = uploadBytes(storageRef, optimized, { contentType: 'image/jpeg' })
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firebase Storage timeout')), 2000)
    )

    await Promise.race([uploadPromise, timeoutPromise])
    const url = await getDownloadURL(storageRef)
    return { url, path }
  } catch (err) {
    storageBucketReady = false
    console.warn('ใช้ภาพ Preview แบบบีบอัดความเร็วสูง:', err?.message)
    return { url: localPreview, path: '' }
  }
}

export const saveCloudPrompt = async ({ id, data, imageFile, precompressedPreview = '' }) => {
  let image = null
  if (imageFile) {
    image = await uploadPromptImage(imageFile, precompressedPreview)
  }

  const now = serverTimestamp()
  const payload = {
    title: data.title.trim(),
    prompt: data.promptText.trim(),
    negative_prompt: data.negativePrompt.trim(),
    category: data.category,
    page: data.category,
    folder: (data.folder || '').trim(),
    tags: data.tags,
    notes: data.notes.trim(),
    tool: data.tool.trim(),
    favorite: Boolean(data.favorite),
    updated_at: now,
  }

  if (typeof data.sortOrder === 'number') {
    payload.sort_order = data.sortOrder
  }

  if (image?.url) {
    payload.image_url = image.url
    payload.image_urls = [image.url]
    payload.image_path = image.path || ''
  } else if (data.imageUrls?.length) {
    payload.image_url = data.imageUrls[0]
    payload.image_urls = data.imageUrls
    payload.image_path = data.imagePath || ''
  } else {
    payload.image_url = ''
    payload.image_urls = []
    payload.image_path = ''
  }

  const firestoreOp = id
    ? updateDoc(doc(db, COLLECTION, id), payload).then(() =>
        normalizePrompt(id, { ...data, ...payload, updated_at: new Date().toISOString() })
      )
    : addDoc(collection(db, COLLECTION), { ...payload, created_at: now }).then((created) =>
        normalizePrompt(created.id, { ...data, ...payload, created_at: new Date().toISOString() })
      )

  const timeoutOp = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Firestore timeout')), 6000)
  )

  return await Promise.race([firestoreOp, timeoutOp])
}

export const updateCloudPrompt = async (item) => {
  if (!item?.id || String(item.id).startsWith('local-')) return
  const payload = {
    favorite: Boolean(item.favorite),
    folder: (item.folder || '').trim(),
    updated_at: serverTimestamp(),
  }
  if (item.category) {
    payload.category = item.category
    payload.page = item.category
  }
  if (typeof item.sortOrder === 'number') {
    payload.sort_order = item.sortOrder
  }
  await updateDoc(doc(db, COLLECTION, item.id), payload)
}

export const updateCloudPromptsOrder = async (itemsToUpdate = []) => {
  await Promise.allSettled(
    itemsToUpdate
      .filter((item) => item?.id && !String(item.id).startsWith('local-'))
      .map((item) =>
        updateDoc(doc(db, COLLECTION, item.id), {
          sort_order: item.sortOrder,
          folder: (item.folder || '').trim(),
        })
      )
  )
}

export const deleteCloudPrompt = async (item) => {
  if (!item?.id || String(item.id).startsWith('local-')) return
  try {
    await deleteDoc(doc(db, COLLECTION, item.id))
  } catch (err) {
    console.warn('deleteDoc error:', err)
  }
  if (item.imagePath) {
    try {
      await deleteObject(ref(storage, item.imagePath))
    } catch {
      // A missing image must not make the prompt record look undeletable.
    }
  }
}

// =====================================================================
// Savings / เงินออม — CRUD helpers
// =====================================================================

const normalizeTxn = (id, data = {}) => ({
  id,
  type: data.type || 'income', // 'income' | 'expense'
  amount: Number(data.amount) || 0,
  label: data.label || '',
  date: data.date || new Date().toISOString().slice(0, 10), // YYYY-MM-DD
  createdAt: asDateValue(data.created_at || data.createdAt),
})

export const readLocalSavings = () => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SAVINGS_KEY) || '[]')
  } catch {
    return []
  }
}

export const writeLocalSavings = (txns) => {
  try {
    localStorage.setItem(LOCAL_SAVINGS_KEY, JSON.stringify(txns))
  } catch {
    // storage full – ignore
  }
}

export const loadCloudSavings = async () => {
  const snap = await getDocs(collection(db, SAVINGS_COLLECTION))
  return snap.docs.map((d) => normalizeTxn(d.id, d.data()))
}

export const saveCloudSavingsTxn = async (txn) => {
  const docRef = await addDoc(collection(db, SAVINGS_COLLECTION), {
    type: txn.type,
    amount: txn.amount,
    label: txn.label,
    date: txn.date,
    created_at: serverTimestamp(),
  })
  return docRef.id
}

export const deleteCloudSavingsTxn = async (id) => {
  if (!id || String(id).startsWith('local-')) return
  try {
    await deleteDoc(doc(db, SAVINGS_COLLECTION, id))
  } catch (err) {
    console.warn('deleteDoc (savings) error:', err)
  }
}

// =====================================================================
// Savings Virtual Accounts & Cards — CRUD helpers
// =====================================================================

const SAVINGS_ACCOUNTS_COLLECTION = 'savings_accounts'
const LOCAL_ACCOUNTS_KEY = 'mix-image-prompt-vault.savings-accounts.v1'

const DEFAULT_ACCOUNTS = [
  {
    id: 'kbank-main',
    type: 'bank',
    bank: 'kbank',
    bankName: 'ธนาคารกสิกรไทย',
    bankCode: 'KBANK',
    accNumber: '199-8-81994-2',
    accName: 'NATTANONT VONGKASAI',
    label: 'บัญชีหลักรับเงิน',
    color: 'kbank',
    createdAt: new Date().toISOString(),
  }
]

export const readLocalAccounts = () => {
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNTS_KEY)
    if (!raw) return DEFAULT_ACCOUNTS
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_ACCOUNTS
  } catch {
    return DEFAULT_ACCOUNTS
  }
}

export const writeLocalAccounts = (accounts) => {
  try {
    localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // ignore
  }
}

const normalizeAccount = (id, data = {}) => ({
  id,
  type: data.type || 'bank',
  bank: data.bank || 'kbank',
  bankName: data.bankName || 'ธนาคารกสิกรไทย',
  bankCode: data.bankCode || 'KBANK',
  accNumber: data.accNumber || data.account_number || '',
  accName: data.accName || data.account_name || '',
  label: data.label || '',
  color: data.color || 'kbank',
  createdAt: asDateValue(data.created_at || data.createdAt),
})

export const loadCloudAccounts = async () => {
  const snap = await getDocs(collection(db, SAVINGS_ACCOUNTS_COLLECTION))
  if (snap.empty) {
    return DEFAULT_ACCOUNTS
  }
  return snap.docs.map((d) => normalizeAccount(d.id, d.data()))
}

export const saveCloudAccount = async (acc) => {
  const docRef = await addDoc(collection(db, SAVINGS_ACCOUNTS_COLLECTION), {
    type: acc.type || 'bank',
    bank: acc.bank || 'kbank',
    bankName: acc.bankName || 'ธนาคารกสิกรไทย',
    bankCode: acc.bankCode || 'KBANK',
    accNumber: acc.accNumber || '',
    accName: acc.accName || '',
    label: acc.label || '',
    color: acc.color || 'kbank',
    created_at: serverTimestamp(),
  })
  return docRef.id
}

export const updateCloudAccount = async (acc) => {
  if (!acc?.id || String(acc.id).startsWith('local-')) return
  try {
    await updateDoc(doc(db, SAVINGS_ACCOUNTS_COLLECTION, acc.id), {
      type: acc.type || 'bank',
      bank: acc.bank || 'kbank',
      bankName: acc.bankName || 'ธนาคารกสิกรไทย',
      bankCode: acc.bankCode || 'KBANK',
      accNumber: acc.accNumber || '',
      accName: acc.accName || '',
      label: acc.label || '',
      color: acc.color || 'kbank',
      updated_at: serverTimestamp(),
    })
  } catch (err) {
    console.warn('updateDoc (account) error:', err)
  }
}

export const deleteCloudAccount = async (id) => {
  if (!id || String(id).startsWith('local-')) return
  try {
    await deleteDoc(doc(db, SAVINGS_ACCOUNTS_COLLECTION, id))
  } catch (err) {
    console.warn('deleteDoc (account) error:', err)
  }
}
