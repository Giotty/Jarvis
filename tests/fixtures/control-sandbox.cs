using System;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
class JarvisControlSandbox {
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [STAThread] static void Main() {
    Application.EnableVisualStyles();
    using (var form = new Form())
    using (var timer = new Timer()) {
      form.Text = "JARVIS control sandbox";
      form.Size = new Size(600, 360);
      form.StartPosition = FormStartPosition.CenterScreen;
      var menu = new MenuStrip();
      var library = new ToolStripMenuItem("LIBRARY");
      menu.Items.Add(library);
      form.Controls.Add(menu);
      var tabs = new TabControl { Location = new Point(15,45), Size = new Size(550,240) };
      tabs.TabPages.Add(new TabPage("Home"));
      tabs.TabPages.Add(new TabPage("Collections") { BackColor = Color.LightGreen });
      tabs.TabPages.Add(new TabPage("Reports") { BackColor = Color.LightBlue });
      library.Click += delegate { tabs.SelectedIndex = 2; };
      form.Controls.Add(tabs);
      timer.Interval = 60000;
      timer.Tick += delegate { form.Close(); };
      form.Shown += delegate { timer.Start(); ShowWindow(form.Handle, 5); form.Activate(); };
      Application.Run(form);
    }
  }
}
