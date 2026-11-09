using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MIXPromptVault
{
    public class MainForm : Form
    {
        private WebView2 webView = null!;
        private const string AppUrl = "https://woon-miximage.github.io/mix-image-prompt-vault/";
        private bool isFullscreen = false;
        private FormWindowState prevWindowState;
        private FormBorderStyle prevBorderStyle;

        public MainForm()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "MIX Image Prompt Archive";
            this.Size = new Size(1360, 880);
            this.MinimumSize = new Size(480, 600);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(13, 17, 23);

            try
            {
                var exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (exeIcon != null)
                {
                    this.Icon = exeIcon;
                }
                else
                {
                    string localIco = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app.ico");
                    if (File.Exists(localIco))
                    {
                        this.Icon = new Icon(localIco);
                    }
                }
            }
            catch
            {
                // Ignore icon loading fallback
            }

            webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(13, 17, 23)
            };

            this.Controls.Add(webView);
            this.Load += MainForm_Load;
        }

        private async void MainForm_Load(object? sender, EventArgs e)
        {
            try
            {
                string userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MIXPromptVault",
                    "UserData"
                );

                if (!Directory.Exists(userDataFolder))
                {
                    Directory.CreateDirectory(userDataFolder);
                }

                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);

                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
                webView.CoreWebView2.Settings.IsSwipeNavigationEnabled = true;

                // Sync window title with webpage title if desired
                webView.CoreWebView2.DocumentTitleChanged += (s, ev) =>
                {
                    if (!string.IsNullOrWhiteSpace(webView.CoreWebView2.DocumentTitle))
                    {
                        this.Text = webView.CoreWebView2.DocumentTitle;
                    }
                };

                // Enable keyboard shortcuts
                this.KeyPreview = true;
                this.KeyDown += (s, args) =>
                {
                    if (args.KeyCode == Keys.F5 || (args.Control && args.KeyCode == Keys.R))
                    {
                        webView.Reload();
                        args.Handled = true;
                    }
                    else if (args.KeyCode == Keys.F11)
                    {
                        ToggleFullscreen();
                        args.Handled = true;
                    }
                };

                webView.Source = new Uri(AppUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"ไม่สามารถเปิดเว็บแอปได้: {ex.Message}\nโปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต",
                    "ข้อผิดพลาด",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private void ToggleFullscreen()
        {
            if (!isFullscreen)
            {
                prevWindowState = this.WindowState;
                prevBorderStyle = this.FormBorderStyle;
                this.FormBorderStyle = FormBorderStyle.None;
                this.WindowState = FormWindowState.Maximized;
                isFullscreen = true;
            }
            else
            {
                this.FormBorderStyle = prevBorderStyle;
                this.WindowState = prevWindowState;
                isFullscreen = false;
            }
        }
    }
}
