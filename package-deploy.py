import os
import zipfile

def build_zip():
    dist_dir = os.path.abspath('dist')
    zip_path = os.path.abspath('dist-deploy.zip')

    if os.path.exists(zip_path):
        os.remove(zip_path)

    # Copy fallback files to root of dist if not present
    brand_logo = os.path.join(dist_dir, 'brand', 'logo.png')
    root_logo = os.path.join(dist_dir, 'logo.png')
    if os.path.exists(brand_logo) and not os.path.exists(root_logo):
        import shutil
        shutil.copy2(brand_logo, root_logo)

    brand_hero = os.path.join(dist_dir, 'brand', 'hero.png')
    root_hero = os.path.join(dist_dir, 'hero.png')
    if os.path.exists(brand_hero) and not os.path.exists(root_hero):
        import shutil
        shutil.copy2(brand_hero, root_hero)

    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(dist_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, dist_dir).replace('\\', '/')
                z.write(full_path, rel_path)

    print(f'Successfully created {zip_path} with standard forward slash paths.')

if __name__ == '__main__':
    build_zip()
