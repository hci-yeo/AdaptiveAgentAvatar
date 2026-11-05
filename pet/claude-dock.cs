// claude-dock: keeps the Claude pet in her spot on the Claude desktop app's window, and tells the
// watcher what Claude is doing there. Started by the watcher (pet-host.mjs) inside Windows
// PowerShell (Add-Type compiles it in memory, then [ClaudeDock]::Main() runs it): no program file of
// our own, so antivirus tools have no new, unsigned .exe to hold up and send for analysis (Avast's
// CyberCapture did, for ~35 s).
//
// Claude can't be injected into (it refuses a DevTools port), so this reads its window the way a
// screen reader does, through Windows UI Automation: where the chat box and the chat column are (so
// she can stand in the empty space left of the chat box, right of the sidebar), whether its Stop
// button is showing (Claude is answering), and the text in its prompt box, so that a prompt you send
// (the box empties and Stop appears) can be given its topic. That works in the Chat tab as well as
// the Code tab. The prompt is passed to the watcher only (its local topic model), never stored.
// Nothing in Claude is changed; only the pet's own window is moved.
//
// stdin  (from the watcher): "pet <hwnd>"                   the pet window to dock (0: none)
//                            "place bottom-left"            beside the chat box (the default)
//                            "place top-left|top-right|bottom-right"  a corner of the chat area
//                            "place custom <fx> <fy>"       where she was dragged: her middle and her
//                                                           feet as fractions of Claude's window
//                            "place free [<x> <y>]"         free on the desktop, always on top, not
//                                                           following Claude (x, y: her window's spot)
//                            "place chat"                   in the chat: the chat-avatar mod draws her
//                                                           inside Claude's replies, so her window hides
//                            "place free-corner <corner> [main]"  free, in a corner of her screen (main:
//                                                           of the main screen, by the taskbar's clock)
//                            "hold 1" / "hold 0"            being dragged: leave her be / then keep
//                                                           her where she was dropped (dragging is
//                                                           now done here, see "Dragging her")
//                            "ring <hwnd>"                  the rainbow chat box window (pet\ring.html):
//                                                           laid over Claude's chat box, just below her
// stdout (to the watcher):   {"claude":true|false}   Claude's window came or went
//                            {"show":true|false}     whether the pet should show (not minimised,
//                                                    not on another virtual desktop); the pet program
//                                                    shows and hides its own window (so its page knows)
//                            {"dark":true|false}     Claude's light or dark theme, from the colour of
//                                                    its background near the right edge (sampled every
//                                                    couple of seconds while Claude is the active window)
//                            {"prompt":"...","chat":"..."}   a prompt was sent, in that chat (see ChatKey)
//                            {"chat":"..."}          another chat was opened (or a new chat got its address)
//                            {"busy":true|false}     its Stop button appeared / went away
//                            {"placed":{"mode":"custom","fx":..,"fy":..}}   where a drag left her
//                            {"placed":{"mode":"free","x":..,"y":..}}       ... or, free, where she is
//                            {"box":true|false}      Claude's chat box was found / is gone (the rainbow
//                                                    ring shows only while it's there)
// It exits when stdin closes (the watcher has gone).
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;

public static class ClaudeDock {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc, int x, int y);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);

  const uint GW_OWNER = 4, GW_HWNDPREV = 3;
  const int GWL_EXSTYLE = -20, WS_EX_TOPMOST = 0x8;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
  const uint SWP_NOSIZE = 0x1, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_NOOWNERZORDER = 0x200;
  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1), HWND_NOTOPMOST = new IntPtr(-2);
  // In DIPs (96-dpi pixels): her box's width (the page draws her 170 wide), her feet above the bottom
  // edge, and how far below the chat area's top her feet stand in a top corner.
  const double HER_W = 170, FEET = 10, TOP_FEET = 290, MARGIN = 16;
  // The chat box's edge is this far outside its row of controls (+, the prompt, Stop, the mic), and
  // the rainbow ring's window is the box plus room for its glow (--p in ring.html).
  const double BOX_PAD = 9.6, RING_PAD = 38;

  // Measured inside Claude's window, kept relative to its edges (left, top, right, bottom), so she
  // moves with the window at once while it's dragged, between measurements.
  class Layout { public double ContentL, ContentT, ContentR, ChatL, ChatB, BoxL, BoxT, BoxR, BoxB; public bool HasBox; }
  class Place { public string Mode = "bottom-left"; public double Fx, Fy; public int X = int.MinValue, Y = int.MinValue; public string Corner; public bool Main; }

  static volatile int petHandle, claudeHandle, ringHandle;
  static volatile bool showing, holding, dropped;
  static volatile Layout layout;               // from UI Automation, null while unknown
  static volatile Place place = new Place();
  static readonly object outLock = new object();

  static void Say(string json) { lock (outLock) { Console.WriteLine(json); Console.Out.Flush(); } }
  static string N(double v) { return v.ToString("0.####", CultureInfo.InvariantCulture); }
  // Pure ASCII out: everything past '~' is written as \uXXXX. The console's code page is the system's
  // (936 on Chinese Windows), not UTF-8, so Chinese text written as-is reached the watcher garbled.
  static string Json(string s) {
    var b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < ' ' || c > '~') b.Append('\\').Append('u').Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  static string ImageOf(IntPtr hwnd) {
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    IntPtr p = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
    if (p == IntPtr.Zero) return "";
    try { var sb = new StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(p, 0, sb, ref n) ? sb.ToString() : ""; }
    finally { CloseHandle(p); }
  }
  // Which app this helper docks to: "claude" (Main) or "kimi" (Run("kimi")). One helper per app.
  static string appId = "claude";
  static bool IsKimi { get { return appId == "kimi"; } }

  // The Claude desktop app: its app package's app\claude.exe (not the Claude Code
  // command-line tool, which is also called claude.exe). Kimi: its per-user install's Kimi.exe.
  static bool IsClaudeApp(string path) {
    path = path.ToLowerInvariant();
    if (IsKimi) return path.EndsWith(@"\programs\kimi\kimi.exe");
    return path.Contains(@"\windowsapps\claude_") && path.EndsWith(@"\app\claude.exe");
  }

  // Kimi builds its accessibility tree only once it believes a screen reader is there. Asking for its
  // window's (and inner windows') accessible objects the older way (MSAA, as screen readers do) and
  // walking a few levels is enough: no system setting is touched, and the tree then stays.
  [ComImport, Guid("618736E0-3C3D-11CF-810C-00AA00389B71"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
  interface IAccessible {
    [DispId(-5000)] object accParent { get; }
    [DispId(-5001)] int accChildCount { get; }
  }
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object o);
  [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible a, int start, int count, [Out] object[] kids, out int got);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  static int WalkMsaa(IAccessible a, int depth) {
    int n = 0;
    try {
      int c = a.accChildCount;
      if (c <= 0 || depth > 6) return 0;
      var kids = new object[Math.Min(c, 200)]; int got;
      AccessibleChildren(a, 0, kids.Length, kids, out got);
      for (int i = 0; i < got; i++) { n++; var k = kids[i] as IAccessible; if (k != null) n += WalkMsaa(k, depth + 1); }
    } catch { }
    return n;
  }
  static void WakeAccessibility(IntPtr top) {
    var iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    var hwnds = new System.Collections.Generic.List<IntPtr> { top };
    EnumChildWindows(top, (h, l) => { hwnds.Add(h); return true; }, IntPtr.Zero);
    foreach (var h in hwnds) {
      try { object o; if (AccessibleObjectFromWindow(h, 0xFFFFFFFC /* OBJID_CLIENT */, ref iid, out o) == 0 && o is IAccessible) WalkMsaa((IAccessible)o, 0); } catch { }
    }
  }
  // Claude's theme: the middle brightness of three spots just inside its window's right edge (its
  // page background there), or null if they can't be read.
  static bool? DarkTheme(RECT f, double scale) {
    IntPtr dc = GetDC(IntPtr.Zero);
    if (dc == IntPtr.Zero) return null;
    try {
      int x = f.R - (int)Math.Round(6 * scale), h = f.B - f.T;
      var lum = new double[3];
      int[] ys = { f.T + h * 2 / 5, f.T + h * 3 / 5, f.B - (int)Math.Round(10 * scale) };
      for (int i = 0; i < 3; i++) {
        uint c = GetPixel(dc, x, ys[i]);
        if (c == 0xFFFFFFFF) return null;   // off screen
        lum[i] = 0.2126 * (c & 0xFF) + 0.7152 * ((c >> 8) & 0xFF) + 0.0722 * ((c >> 16) & 0xFF);
      }
      Array.Sort(lum);
      return lum[1] < 110;
    } finally { ReleaseDC(IntPtr.Zero, dc); }
  }

  static bool Cloaked(IntPtr h) { int v; return DwmGetWindowAttribute(h, DWMWA_CLOAKED, out v, 4) == 0 && v != 0; }

  // Claude's main window: its biggest visible, unowned top-level window.
  static IntPtr FindClaude() {
    IntPtr best = IntPtr.Zero; long bestArea = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      long area = (long)(r.R - r.L) * (r.B - r.T);
      if (area <= bestArea || area < 200 * 200) return true;
      if (!IsClaudeApp(ImageOf(h))) return true;
      best = h; bestArea = area; return true;
    }, IntPtr.Zero);
    return best;
  }

  // ---- Inside Claude's window, through UI Automation (4 times a second, on its own thread) ----
  // The Stop button's name in the apps' interface languages (Kimi's own "stop" strings, all 16 of its
  // languages; Claude's English one). A name that starts with one counts ("Stop response").
  static readonly string[] StopWords = { "Stop", "Stoppen", "Arrêter", "Detener", "Parar", "Interrompi", "Остановить",
    "Durdur", "Dừng", "Henti", "중지", "หยุด", "إيقاف" };
  static bool IsStop(AutomationElement e) {
    var c = e.Current;
    if (c.ControlType != ControlType.Button || c.Name == null) return false;
    string n = c.Name.Trim();
    if (n.Contains("停止") || n.Contains("中止")) return true;   // Chinese, Japanese
    foreach (var w in StopWords) if (n.StartsWith(w, StringComparison.OrdinalIgnoreCase)) return true;
    return false;
  }
  // The prompt box: the edit named "Prompt", else the lowest wide edit in the window.
  static AutomationElement FindPrompt(AutomationElement win) {
    var editType = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
    // Kimi keeps its Work and Chat pages both loaded, and both chat boxes say they're on screen: take
    // the one in front (what's at its centre is the box itself, or inside it).
    if (IsKimi) { var front = FrontEdit(win, editType); if (front != null) return front; }
    var named = win.FindFirst(TreeScope.Descendants, new AndCondition(editType, new PropertyCondition(AutomationElement.NameProperty, "Prompt")));
    if (named != null) return named;
    // Otherwise the lowest wide text field. Claude's Chat page names its box "Write your prompt to
    // Claude" (a ProseMirror editor): that one wins outright. Its sidebar's "Rename" field (renaming a
    // chat) can sit lower and is never the chat box.
    AutomationElement best = null; double bottom = double.MinValue;
    foreach (AutomationElement e in win.FindAll(TreeScope.Descendants, editType)) {
      Rect r = e.Current.BoundingRectangle;
      if (r.IsEmpty || r.Width <= 250) continue;
      if (!IsKimi && (e.Current.ClassName ?? "").Contains("ProseMirror")) return e;
      if (e.Current.Name == "Rename") continue;
      if (r.Bottom > bottom) { best = e; bottom = r.Bottom; }
    }
    return best;
  }
  // Which chat is open: so the watcher keeps each chat's questions apart (the pet's topic for one chat
  // shouldn't be decided by questions from another). Read off the page that holds the prompt box:
  //   Claude (Code and Chat tabs), Kimi's Chat tab: the page's address, without ?query and #hash
  //     (claude.ai/epitaxy/<session>, claude.ai/chat/<id>; claude.ai/new, www.kimi.ai/ for a new chat)
  //   Kimi's Work tab: its page has no per-task address, so the address plus "#" and the open task's
  //     title (its sidebar row is marked "active"), or "#new" while none is open (New task)
  // Null when it can't be read. Cheap: up from the prompt box to its page, and in Kimi's Work page only
  // its sidebar (the main pane, with the whole conversation, is skipped).
  static string ChatKey(AutomationElement edit) {
    AutomationElement doc = edit;
    for (int i = 0; i < 60 && doc != null && doc.Current.ControlType != ControlType.Document; i++)
      doc = TreeWalker.RawViewWalker.GetParent(doc);
    if (doc == null) return null;
    object vp;
    if (!doc.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) return null;
    string url = ((ValuePattern)vp).Current.Value ?? "";
    int cut = url.IndexOfAny(new[] { '?', '#' });
    if (cut >= 0) url = url.Substring(0, cut);
    if (url.Length == 0) return null;
    if (url.StartsWith("http", StringComparison.OrdinalIgnoreCase) || !IsKimi) return url;
    return url + "#" + (KimiActiveTask(doc) ?? "new");
  }
  // Kimi's Work page: the title of the task whose sidebar row ("conversation-row ... active") is open.
  static string KimiActiveTask(AutomationElement doc) {
    var walker = TreeWalker.RawViewWalker;   // the row itself is a plain container, left out of the control view
    var queue = new System.Collections.Generic.Queue<AutomationElement>();
    queue.Enqueue(doc);
    for (int seen = 0; queue.Count > 0 && seen < 800; seen++) {
      var e = queue.Dequeue();
      string cls = " " + (e.Current.ClassName ?? "") + " ";
      if (cls.Contains(" conversation-row ") && cls.Contains(" active ")) {
        var main = walker.GetFirstChild(e);
        string name = main != null ? main.Current.Name : e.Current.Name;
        return string.IsNullOrWhiteSpace(name) ? null : name.Trim();
      }
      // Not into the main pane (the open task's whole conversation) or the message list.
      if (cls.Contains(" main-pane ") || cls.Contains(" message-list-container ")) continue;
      for (var k = walker.GetFirstChild(e); k != null; k = walker.GetNextSibling(k)) queue.Enqueue(k);
    }
    return null;
  }
  static AutomationElement FrontEdit(AutomationElement win, Condition editType) {
    // What's at a point is the box itself or something inside it, or (Kimi 3.2.24 answers only that
    // roughly) the page in front: the box counts when that page is its own. A box on the page behind
    // gets the front page there, not its own. Several points along the box, in case another window
    // covers part of it.
    foreach (AutomationElement e in win.FindAll(TreeScope.Descendants, editType)) {
      Rect r = e.Current.BoundingRectangle;
      if (r.IsEmpty || r.Width <= 250) continue;
      AutomationElement doc = e;
      for (int i = 0; i < 60 && doc != null && doc.Current.ControlType != ControlType.Document; i++)
        doc = TreeWalker.RawViewWalker.GetParent(doc);
      foreach (double fx in new[] { 0.5, 0.15, 0.85 }) {
        AutomationElement hit;
        try { hit = AutomationElement.FromPoint(new Point(r.Left + r.Width * fx, r.Top + r.Height / 2)); } catch { continue; }
        if (hit == null) continue;
        if (doc != null && Automation.Compare(hit, doc)) return e;
        for (int i = 0; i < 4 && hit != null; i++) {
          if (Automation.Compare(hit, e)) return e;
          hit = TreeWalker.RawViewWalker.GetParent(hit);
        }
      }
    }
    return null;
  }
  // Kimi's Chat page: the element framing its chat box ("chat-editor-wrap"), and its chat area
  // ("layout-content", right of the sidebar). Null on the Work page, which has neither.
  static AutomationElement KimiChatBox(AutomationElement edit, out AutomationElement area) {
    area = null;
    AutomationElement wrap = null, p = edit;
    for (int i = 0; i < 10; i++) {
      p = TreeWalker.RawViewWalker.GetParent(p);
      if (p == null) break;
      string cls = " " + (p.Current.ClassName ?? "") + " ";
      if (wrap == null && cls.Contains(" chat-editor-wrap ")) wrap = p;
      else if (wrap != null && cls.Contains(" layout-content ")) { area = p; break; }
    }
    return wrap;
  }
  // Where the chat box is: its row of controls (level with the prompt box) plus any row right under
  // it that's no wider (a toolbar inside the box), plus the padding to its edge (Code page); or the
  // framed box that wraps the text area and a row of buttons under it (Chat page): the biggest
  // ancestor of the prompt box that's still about chat-box size, down to just under its lowest
  // control within its width (the frame also holds the wider options row below the box).
  // Also: whether a Stop button shows. Returns null when the prompt box isn't usable.
  static Layout Measure(AutomationElement edit, int h, out bool stop, StringBuilder dbg) {
    if (IsKimi) return MeasureKimi(edit, h, out stop, dbg);
    var walker = TreeWalker.ControlViewWalker;
    var buttons = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
    stop = false;
    AutomationElement column = walker.GetParent(walker.GetParent(edit));
    if (column == null) return null;
    Rect er = edit.Current.BoundingRectangle, cr = column.Current.BoundingRectangle;
    if (er.IsEmpty || er.Width <= 0 || edit.Current.IsOffscreen) return null;
    if (dbg != null) dbg.AppendLine("prompt '" + edit.Current.Name + "' " + er + "  column " + cr);
    // A long prompt scrolls inside the box (its parent has a maximum height and scrolls): the prompt's
    // own rectangle is then all of its text, reaching far above the box, and the ring grew with it.
    // Only the part showing in that scroll area counts.
    AutomationElement scroller = walker.GetParent(edit);
    if (scroller != null) {
      Rect sr = scroller.Current.BoundingRectangle;
      if (!sr.IsEmpty && sr.Height >= 20 && (er.Top < sr.Top - 2 || er.Bottom > sr.Bottom + 2)) {
        double sTop = Math.Max(er.Top, sr.Top), sBottom = Math.Min(er.Bottom, sr.Bottom);
        if (sBottom - sTop >= 20) {
          er = new Rect(er.Left, sTop, er.Width, sBottom - sTop);
          if (dbg != null) dbg.AppendLine("prompt scrolls; showing " + er);
        }
      }
    }
    double left = er.Left, bottom = er.Bottom;
    var parts = new System.Collections.Generic.List<Rect>();
    foreach (AutomationElement c in column.FindAll(TreeScope.Children, Condition.TrueCondition)) {
      Rect k = c.Current.BoundingRectangle;
      if (k.IsEmpty || k.Top < er.Top - 40 || k.Width < 20 || k.Height < 20) continue;
      parts.Add(k);
      left = Math.Min(left, k.Left); bottom = Math.Max(bottom, k.Bottom);
      if (!stop) {
        if (IsStop(c)) stop = true;
        else foreach (AutomationElement b in c.FindAll(TreeScope.Descendants, buttons)) if (IsStop(b)) { stop = true; break; }
      }
    }
    double sc = GetDpiForWindow(new IntPtr(h)) / 96.0, pad = BOX_PAD * sc;
    double bl = er.Left, bt = er.Top, br = er.Right, bb = er.Bottom;
    foreach (Rect k in parts) {
      double mid = (k.Top + k.Bottom) / 2;
      if (mid >= er.Top - 4 && mid <= er.Bottom + 4) { bl = Math.Min(bl, k.Left); bt = Math.Min(bt, k.Top); br = Math.Max(br, k.Right); bb = Math.Max(bb, k.Bottom); }
    }
    foreach (Rect k in parts)
      if (k.Top >= bb - 4 && k.Top <= bb + 2 * pad && k.Left >= bl - 4 && k.Right <= br + 4) bb = Math.Max(bb, k.Bottom);
    bl -= pad; bt -= pad; br += pad; bb += pad;
    if (dbg != null) dbg.AppendLine("row box " + bl + "," + bt + " .. " + br + "," + bb);
    Rect frame = Rect.Empty; AutomationElement frameEl = null;
    AutomationElement anc = walker.GetParent(edit);
    for (int i = 0; i < 6 && anc != null; i++) {
      Rect r = anc.Current.BoundingRectangle;
      if (r.IsEmpty || r.Width > er.Width + 300 * sc || r.Height > er.Height + 260 * sc) break;
      frame = r; frameEl = anc;
      anc = walker.GetParent(anc);
    }
    if (dbg != null) dbg.AppendLine("frame " + frame);
    if (!frame.IsEmpty && frame.Height >= er.Height + 30 * sc) {
      double inside = er.Bottom;
      foreach (AutomationElement c in frameEl.FindAll(TreeScope.Children, Condition.TrueCondition)) {
        Rect k = c.Current.BoundingRectangle;
        if (!k.IsEmpty && k.Height >= 8 && k.Left >= frame.Left - 1 && k.Right <= frame.Right + 1) inside = Math.Max(inside, k.Bottom);
      }
      bl = frame.Left; bt = frame.Top; br = frame.Right; bb = Math.Min(frame.Bottom, inside + pad);
      if (!stop) foreach (AutomationElement b in frameEl.FindAll(TreeScope.Descendants, buttons)) if (IsStop(b)) { stop = true; break; }
      if (dbg != null) dbg.AppendLine("framed box " + bl + "," + bt + " .. " + br + "," + bb);
    }
    RECT f;
    if (DwmGetWindowAttribute(new IntPtr(h), DWMWA_EXTENDED_FRAME_BOUNDS, out f, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(new IntPtr(h), out f);
    var lo = new Layout();
    lo.ContentL = cr.Left - f.L; lo.ContentT = cr.Top - f.T; lo.ContentR = f.R - cr.Right;
    lo.ChatL = left - f.L; lo.ChatB = f.B - bottom;
    lo.BoxL = bl - f.L; lo.BoxT = bt - f.T; lo.BoxR = f.R - br; lo.BoxB = f.B - bb;
    lo.HasBox = br - bl > 100;
    return lo;
  }

  // Kimi, Work page: the text field's parent is the chat area (right of the sidebar). The box is the
  // text field plus its own row of controls just under it (+, model, voice, Send / Stop: within ~30
  // DIPs, inside its width); the next row (project, plugins) is well below and outside the box.
  // Chat page: the box is its framing element (see KimiChatBox).
  static Layout MeasureKimi(AutomationElement edit, int h, out bool stop, StringBuilder dbg) {
    stop = false;
    Rect er = edit.Current.BoundingRectangle;
    if (er.IsEmpty || er.Width <= 0 || edit.Current.IsOffscreen) return null;
    AutomationElement column = TreeWalker.ControlViewWalker.GetParent(edit);
    if (column == null) return null;
    Rect cr = column.Current.BoundingRectangle;
    // Its border, measured on a capture of Kimi 3.2 (125%): 7.2 DIPs left of the text field, 11 above
    // it, 5 right of it, and 7 below the row of controls (the rainbow ring then runs the same ~1 px
    // outside the border on all four sides, so its corners line up too).
    double sc = GetDpiForWindow(new IntPtr(h)) / 96.0, padL = 7.2 * sc, padT = 11 * sc, padR = 5 * sc, padB = 7 * sc;
    double bl = er.Left, bt = er.Top, br = er.Right, bb = er.Bottom;
    var buttons = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button);
    AutomationElement area, wrap = KimiChatBox(edit, out area);
    if (wrap != null) {
      // Chat page: its frame is an element of its own. Its border runs ~2 px inside that element (as
      // on the Work page, where the measured border sits ~2 px inside its "composer" element).
      Rect w = wrap.Current.BoundingRectangle;
      if (w.IsEmpty) return null;
      if (area != null) cr = area.Current.BoundingRectangle;
      bl = w.Left + 2 * sc; bt = w.Top + 2 * sc; br = w.Right - 2 * sc; bb = w.Bottom - 2 * sc;
      foreach (AutomationElement b in wrap.FindAll(TreeScope.Descendants, buttons)) if (IsStop(b)) { stop = true; break; }
      if (dbg != null) dbg.AppendLine("  chat page frame " + w);
    } else {
      foreach (AutomationElement b in column.FindAll(TreeScope.Descendants, buttons)) {
        Rect k = b.Current.BoundingRectangle;
        if (k.IsEmpty || k.Top < er.Top - 8 * sc || k.Top > er.Bottom + 30 * sc || k.Left < er.Left - 40 * sc || k.Right > er.Right + 40 * sc) continue;
        bl = Math.Min(bl, k.Left); bt = Math.Min(bt, k.Top); br = Math.Max(br, k.Right); bb = Math.Max(bb, k.Bottom);
        if (!stop && IsStop(b)) stop = true;
        if (dbg != null) dbg.AppendLine("  box control '" + b.Current.Name + "' " + k);
      }
      bl -= padL; bt -= padT; br += padR; bb += padB;
    }
    if (dbg != null) dbg.AppendLine("kimi prompt " + er + "  column " + cr + "  box " + bl + "," + bt + " .. " + br + "," + bb);
    RECT f;
    if (DwmGetWindowAttribute(new IntPtr(h), DWMWA_EXTENDED_FRAME_BOUNDS, out f, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(new IntPtr(h), out f);
    var lo = new Layout();
    lo.ContentL = cr.Left - f.L; lo.ContentT = cr.Top - f.T; lo.ContentR = f.R - cr.Right;
    lo.ChatL = bl - f.L; lo.ChatB = f.B - bb;
    lo.BoxL = bl - f.L; lo.BoxT = bt - f.T; lo.BoxR = f.R - br; lo.BoxB = f.B - bb;
    lo.HasBox = br - bl > 100;
    return lo;
  }

  static bool Far(Layout a, Layout b, double by) {
    return a.HasBox != b.HasBox || Math.Abs(a.BoxL - b.BoxL) > by || Math.Abs(a.BoxT - b.BoxT) > by
      || Math.Abs(a.BoxR - b.BoxR) > by || Math.Abs(a.BoxB - b.BoxB) > by;
  }

  // For checking by hand (PowerShell: Add-Type this file, then [ClaudeDock]::Probe()): what the
  // helper measures in Claude's window right now.
  public static string Probe() { return Probe("claude"); }
  public static string Probe(string app) {
    appId = app;
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    IntPtr h = FindClaude();
    if (h == IntPtr.Zero) return "no " + app + " window";
    var dbg = new StringBuilder();
    if (IsKimi) WakeAccessibility(h);
    var edit = FindPrompt(AutomationElement.FromHandle(h));
    if (edit == null) return "no prompt box";
    bool stop;
    Layout lo = Measure(edit, h.ToInt32(), out stop, dbg);
    dbg.AppendLine("stop " + stop + ", has box " + (lo != null && lo.HasBox));
    return dbg.ToString();
  }

  static void WatchInside() {
    AutomationElement win = null, edit = null;
    int winFor = 0, refind = 0, lost = 0, candN = 0;
    Layout cand = null;
    string lastText = "", pending = null, chat = null;
    int chatIn = 0;
    DateTime emptiedAt = DateTime.MinValue, wokeAt = DateTime.MinValue;
    // A prompt, with the chat it was sent in (the chat open now).
    Action<string> sendPrompt = p => Say("{\"prompt\":" + Json(p) + (chat != null ? ",\"chat\":" + Json(chat) : "") + "}");
    bool? stopWas = null, boxWas = null;
    while (true) {
      Thread.Sleep(250);
      int h = claudeHandle;
      if (h == 0 || !showing) { layout = null; continue; }
      try {
        if (winFor != h) { win = AutomationElement.FromHandle(new IntPtr(h)); winFor = h; edit = null; }
        // Look for the prompt box again every second: Claude swaps pages (Code, Chat) in the same window.
        if (edit == null || --refind <= 0) {
          edit = FindPrompt(win); refind = 4;
          // Kimi shows no chat box until its accessibility is woken (at most every 3 s while missing).
          if (edit == null && IsKimi && (DateTime.UtcNow - wokeAt).TotalSeconds > 3) { WakeAccessibility(new IntPtr(h)); wokeAt = DateTime.UtcNow; }
        }
        bool stop = false;
        Layout lo = edit == null ? null : Measure(edit, h, out stop, null);
        // While Claude swaps pages the prompt box is briefly gone: she stays put for up to 2 s
        // instead of jumping to a fallback spot.
        if (lo == null) { edit = null; refind = 0; if (++lost > 8) layout = null; }
        else {
          lost = 0;
          // A big jump (Claude laying out a page it's switching to, while it slides in) waits until two
          // readings in a row agree, so she moves once, straight to where the box settles.
          double sc = GetDpiForWindow(new IntPtr(h)) / 96.0;
          Layout cur = layout;
          if (cur != null && Far(lo, cur, 40 * sc)) {
            if (cand != null && !Far(lo, cand, 4 * sc)) { if (++candN >= 2) { layout = lo; cand = null; } }
            else { cand = lo; candN = 1; }
          } else { layout = lo; cand = null; }
          lo = layout;
          if (boxWas != lo.HasBox) { boxWas = lo.HasBox; Say(lo.HasBox ? "{\"box\":true}" : "{\"box\":false}"); }
          // Which chat is open, once a second; a change is reported ({"chat":"..."}).
          if (--chatIn <= 0) {
            chatIn = 4;
            string now = null;
            try { now = ChatKey(edit); } catch (Exception) { }
            if (now != null && now != chat) { chat = now; Say("{\"chat\":" + Json(chat) + "}"); }
          }
          // A prompt is sent when the box empties and Stop shows up (within a few seconds). Not while
          // Claude is already answering: then an emptied box is mostly text deleted (and a message
          // queued meanwhile reaches the watcher from Claude itself, through the chat-avatar mod).
          object vp; string text = null;
          if (edit.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) text = ((ValuePattern)vp).Current.Value;
          if (text != null && IsKimi && text == edit.Current.Name) text = "";   // Kimi reports its placeholder when empty
          if (text != null) {
            if (text.Trim().Length > 0) { lastText = text; pending = null; }
            else if (lastText.Length > 0) {
              if (stopWas != true) { pending = lastText; emptiedAt = DateTime.UtcNow; }
              // Kimi queues a message sent while it answers ("Messages sent now will be queued"), so the
              // box empties while Stop stays: a whole question gone in one reading counts as sent (text
              // deleted key by key shrinks first, so its last reading is short).
              else if (IsKimi && lastText.Trim().Length >= 4) sendPrompt(lastText.Trim());
              lastText = "";
            }
          }
          if (pending != null) {
            if (stop) { sendPrompt(pending.Trim()); pending = null; }
            else if ((DateTime.UtcNow - emptiedAt).TotalSeconds > 4) pending = null;   // deleted, not sent
          }
          if (stopWas != stop) { stopWas = stop; Say(stop ? "{\"busy\":true}" : "{\"busy\":false}"); }
        }
      } catch (Exception) { edit = null; refind = 0; if (++lost > 8) layout = null; }
      if (layout == null && boxWas == true) { boxWas = false; Say("{\"box\":false}"); }
    }
  }

  // Where her middle and her feet go, in screen pixels.
  static void Spot(RECT f, double s, Place pl, Layout lo, out double cx, out double feet) {
    double cL = lo != null ? f.L + lo.ContentL : f.L, cR = lo != null ? f.R - lo.ContentR : f.R, cT = lo != null ? f.T + lo.ContentT : f.T + 48 * s;
    double herW = HER_W * s, m = MARGIN * s;
    switch (pl.Mode) {
      case "top-left": cx = cL + m + herW / 2; feet = cT + TOP_FEET * s; break;
      case "top-right": cx = cR - m - herW / 2; feet = cT + TOP_FEET * s; break;
      case "bottom-right": cx = cR - m - herW / 2; feet = f.B - FEET * s; break;
      case "custom": cx = f.L + pl.Fx * (f.R - f.L); feet = f.T + pl.Fy * (f.B - f.T); break;
      default:   // bottom-left: right beside the chat box, on its left, feet level with its bottom
        if (lo != null && lo.HasBox) {
          cx = f.L + lo.BoxL - m / 2 - herW / 2;
          feet = f.B - lo.BoxB;
        } else if (lo != null) {
          double chatL = f.L + lo.ChatL, gap = chatL - cL;
          cx = gap >= herW + m ? (cL + chatL) / 2 : chatL - m / 2 - herW / 2;   // too narrow: just left of the box
          feet = Math.Min(f.B - lo.ChatB, f.B) - FEET * s;
        } else { cx = f.L + 118 * s; feet = f.B - FEET * s; }
        break;
    }
  }

  // The rainbow ring's window: over the chat box with room for the glow, right below her.
  static int ringX, ringY, ringW, ringH;
  // Whether window a is above window b in the stack.
  static bool IsAbove(IntPtr a, IntPtr b) {
    int n = 0;
    for (IntPtr h = GetWindow(b, GW_HWNDPREV); h != IntPtr.Zero && n < 3000; h = GetWindow(h, GW_HWNDPREV), n++) if (h == a) return true;
    return false;
  }

  // The window to put something right under so it sits just above Claude: the first ordinary
  // window above Claude (not hers), or always-on-top when nothing ordinary is above it.
  static IntPtr SlotAboveClaude(IntPtr claude, IntPtr pet) {
    for (IntPtr h = GetWindow(claude, GW_HWNDPREV); h != IntPtr.Zero; h = GetWindow(h, GW_HWNDPREV)) {
      if (h == pet || h.ToInt32() == ringHandle) continue;
      if (!IsWindowVisible(h) || Cloaked(h)) continue;
      if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0) return HWND_TOPMOST;
      return h;
    }
    return HWND_TOPMOST;
  }

  // after: the window the ring goes right under (her, when she's docked; when she's free, the slot
  // just above Claude).
  static void PlaceRing(IntPtr pet, RECT f, double s, bool restacked, IntPtr claude) {
    IntPtr ring = new IntPtr(ringHandle);
    Layout lo = layout;
    if (ring == IntPtr.Zero || !IsWindow(ring) || lo == null || !lo.HasBox) return;
    int p = (int)Math.Round(RING_PAD * s);
    int x = (int)Math.Round(f.L + lo.BoxL) - p, y = (int)Math.Round(f.T + lo.BoxT) - p;
    int w = (int)Math.Round((f.R - lo.BoxR) - (f.L + lo.BoxL)) + 2 * p, hh = (int)Math.Round((f.B - lo.BoxB) - (f.T + lo.BoxT)) + 2 * p;
    // Its place in the stack is fixed only when she was just restacked, or it isn't between Claude and
    // her any more (see "restack" in Main: other apps' own windows may come in between, and that's fine).
    bool inPlace = !restacked && IsAbove(ring, claude) && (pet == HWND_TOPMOST || IsAbove(pet, ring));
    // Compared with where the window really is: the pet program re-applies its own idea of the
    // window's size when it shows it again (scaled by the display's zoom), so it has to be put right.
    RECT cur; GetWindowRect(ring, out cur);
    if (inPlace && Math.Abs(cur.L - x) <= 1 && Math.Abs(cur.T - y) <= 1 && Math.Abs(cur.R - cur.L - w) <= 1 && Math.Abs(cur.B - cur.T - hh) <= 1) return;
    SetWindowPos(ring, pet, x, y, w, hh, SWP_NOACTIVATE | SWP_NOOWNERZORDER | (inPlace ? SWP_NOZORDER : 0));
    ringX = x; ringY = y; ringW = w; ringH = hh;
  }

  // Free on the desktop: her window's spot for a corner of the screen she's on (its work area, so
  // not under the taskbar), with her box (170 x 239 DIPs, 6 above the window's bottom) 16 in from it.
  [StructLayout(LayoutKind.Sequential)] struct PT { public int X, Y; }
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(PT pt, uint flags);
  static void CornerSpot(IntPtr pet, RECT p, string corner, bool main, out int x, out int y) {
    var mi = new MONITORINFO(); mi.Size = Marshal.SizeOf(typeof(MONITORINFO));
    PT origin = new PT();   // (0, 0) is always on the main screen
    GetMonitorInfo(main ? MonitorFromPoint(origin, 1 /* primary */) : MonitorFromWindow(pet, 2 /* nearest */), ref mi);
    RECT a = mi.Work;
    double sp = GetDpiForWindow(pet) / 96.0, m = MARGIN * sp, herW = HER_W * sp;
    int pw = p.R - p.L, ph = p.B - p.T;
    double side = (pw - herW) / 2;
    x = (int)Math.Round(corner.EndsWith("left") ? a.L + m - side : a.R - m - herW - side);
    y = (int)Math.Round(corner.StartsWith("top") ? a.T + m + (40 + 239 + 6) * sp - ph : a.B - m + 6 * sp - ph);
  }

  public static void Main() { Run("claude"); }
  public static void Run(string app) {
    appId = app == "kimi" ? "kimi" : "claude";
    SetProcessDpiAwarenessContext(new IntPtr(-4));   // per-monitor v2: real pixels everywhere
    var reader = new Thread(() => {
      string line;
      while ((line = Console.ReadLine()) != null) {
        var w = line.Trim().Split(' ');
        int a; double fx, fy;
        if (w.Length == 2 && w[0] == "pet" && int.TryParse(w[1], out a)) petHandle = a;
        if (w.Length == 2 && w[0] == "ring" && int.TryParse(w[1], out a)) ringHandle = a;
        if (w.Length == 2 && w[0] == "hold") { holding = w[1] == "1"; if (!holding) dropped = true; }
        if (w.Length == 2 && w[0] == "place") { var p = new Place(); p.Mode = w[1]; place = p; }
        int fxi, fyi;
        if (w.Length == 4 && w[0] == "place" && w[1] == "free" && int.TryParse(w[2], out fxi) && int.TryParse(w[3], out fyi)) { var p = new Place(); p.Mode = "free"; p.X = fxi; p.Y = fyi; place = p; }
        if ((w.Length == 3 || w.Length == 4) && w[0] == "place" && w[1] == "free-corner") { var p = new Place(); p.Mode = "free"; p.Corner = w[2]; p.Main = w.Length == 4 && w[3] == "main"; place = p; }
        if (w.Length == 4 && w[0] == "place" && w[1] == "custom"
            && double.TryParse(w[2], NumberStyles.Float, CultureInfo.InvariantCulture, out fx)
            && double.TryParse(w[3], NumberStyles.Float, CultureInfo.InvariantCulture, out fy)) {
          // Docked, she stays on Claude's window (her middle and her feet within it).
          var p = new Place(); p.Mode = "custom"; p.Fx = Math.Max(0, Math.Min(1, fx)); p.Fy = Math.Max(0, Math.Min(1, fy)); place = p;
        }
      }
      Environment.Exit(0);   // the watcher has gone
    });
    reader.IsBackground = true;
    reader.Start();
    var inside = new Thread(WatchInside);
    inside.IsBackground = true;
    inside.Start();

    IntPtr claude = IntPtr.Zero;
    bool? said = null, saidShow = null, saidDark = null;
    int lastX = int.MinValue, lastY = int.MinValue, rescan = 0, themeTick = 0;
    IntPtr lastFg = new IntPtr(-1);
    bool dragOn = false, dragMoved = false, wasDown = false;
    int dragCx = 0, dragCy = 0, dragPx = 0, dragPy = 0;
    DateTime pressAt = DateTime.MinValue;   // a press in her window
    while (true) {
      if (claude == IntPtr.Zero || !IsWindow(claude) || !IsWindowVisible(claude) && !IsIconic(claude)) {
        claude = IntPtr.Zero;
        if (--rescan <= 0) { claude = FindClaude(); rescan = 25; }   // about once a second while missing
      }
      claudeHandle = claude.ToInt32();
      bool present = claude != IntPtr.Zero;
      if (said != present) { said = present; Say(present ? "{\"claude\":true}" : "{\"claude\":false}"); }
      bool onScreen = present && !IsIconic(claude) && !Cloaked(claude);
      showing = onScreen;   // (for reading Claude's window)
      bool free = place.Mode == "free", inChat = place.Mode == "chat";
      bool show = free ? present : onScreen;   // free on the desktop: while Claude runs, minimised too
      if (inChat) show = false;   // in the chat: the chat-avatar mod draws her inside the replies

      IntPtr pet = new IntPtr(petHandle);
      if (pet != IntPtr.Zero && IsWindow(pet)) {
        if (saidShow != show) { saidShow = show; Say(show ? "{\"show\":true}" : "{\"show\":false}"); }
        if (!show) {
          lastX = int.MinValue;
        } else {
          RECT f, p;
          if (DwmGetWindowAttribute(claude, DWMWA_EXTENDED_FRAME_BOUNDS, out f, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(claude, out f);
          GetWindowRect(pet, out p);
          double s = GetDpiForWindow(claude) / 96.0;
          if (++themeTick >= 60 && onScreen && GetForegroundWindow() == claude) {   // ~2 s, only while nothing covers it
            themeTick = 0;
            bool? dark = DarkTheme(f, s);
            if (dark.HasValue && dark != saidDark) { saidDark = dark; Say(dark.Value ? "{\"dark\":true}" : "{\"dark\":false}"); }
          }
          // Dragging her, done here rather than by her page: Electron swallows the press on a window
          // that can't take focus while another app is active, so her page saw it only now and then.
          // Her window is click-through everywhere but on her, so "not click-through" means the
          // cursor is on her; a left press there, then a move of 5 px, drags her until the release.
          bool down = (GetAsyncKeyState(0x01) & 0x8000) != 0;
          POINT c; GetCursorPos(out c);
          bool onHer = (GetWindowLong(pet, GWL_EXSTYLE) & 0x20 /* WS_EX_TRANSPARENT */) == 0
            && c.X >= p.L && c.X < p.R && c.Y >= p.T && c.Y < p.B;
          bool inWindow = c.X >= p.L && c.X < p.R && c.Y >= p.T && c.Y < p.B;
          // A press that lands in her window a moment before it has learned the cursor is on her (her
          // page checks a few times a second; moving in fast and pressing beats it): it still starts a
          // drag, from where it was pressed, if she turns out to be under the cursor within 0.2 s.
          if (down && !wasDown && inWindow) { pressAt = DateTime.UtcNow; dragCx = c.X; dragCy = c.Y; dragPx = p.L; dragPy = p.T; }
          if (!dragOn && !inChat && down && onHer && (DateTime.UtcNow - pressAt).TotalMilliseconds < 200) { dragOn = true; dragMoved = false; pressAt = DateTime.MinValue; }
          if (dragOn) {
            if (down) {
              int dx = c.X - dragCx, dy = c.Y - dragCy;
              if (!dragMoved && Math.Abs(dx) + Math.Abs(dy) >= 5) dragMoved = true;
              if (dragMoved) {
                int nx = dragPx + dx, ny = dragPy + dy;
                if (!free) {
                  // Docked: she stays on Claude's window. Her box (170 x 239 DIPs, centred, 6 above
                  // her window's bottom) is kept inside its frame; set her free to go anywhere.
                  int pw = p.R - p.L, ph = p.B - p.T;
                  double herW = HER_W * s, side = (pw - herW) / 2;
                  nx = (int)Math.Round(Math.Max(f.L - side, Math.Min(f.R - herW - side, nx)));
                  ny = (int)Math.Round(Math.Max(f.T + (239 + 6) * s - ph, Math.Min(f.B + 6 * s - ph, ny)));
                }
                SetWindowPos(pet, IntPtr.Zero, nx, ny, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
              }
            } else {
              dragOn = false;
              if (dragMoved) { dropped = true; GetWindowRect(pet, out p); lastFg = new IntPtr(-1); }   // (restack her after the drop)
            }
          }
          wasDown = down;
          if (dropped && free) {
            // A drag just ended, free on the desktop: she stays at that spot of the screen.
            dropped = false;
            var pl = new Place(); pl.Mode = "free"; pl.X = p.L; pl.Y = p.T; place = pl;
            Say("{\"placed\":{\"mode\":\"free\",\"x\":" + p.L + ",\"y\":" + p.T + "}}");
          }
          if (dropped) {
            // A drag just ended: she stays where she was dropped, relative to Claude's window.
            dropped = false;
            double fx = ((p.L + p.R) / 2.0 - f.L) / Math.Max(1, f.R - f.L), fy = (p.B - 6 * s - f.T) / Math.Max(1, f.B - f.T);
            var pl = new Place(); pl.Mode = "custom"; pl.Fx = fx; pl.Fy = fy; place = pl;
            Say("{\"placed\":{\"mode\":\"custom\",\"fx\":" + N(fx) + ",\"fy\":" + N(fy) + "}}");
          }
          if (free && !(dragOn && dragMoved)) {
            // Free on the desktop: her own spot (or a screen corner), always on top, like the other
            // apps' pets; the rainbow ring stays on Claude's chat box, just above Claude.
            Place pl = place;
            if (pl.Corner != null || pl.X == int.MinValue) {
              int nx = p.L, ny = p.T;
              if (pl.Corner != null) CornerSpot(pet, p, pl.Corner, pl.Main, out nx, out ny);
              var np = new Place(); np.Mode = "free"; np.X = nx; np.Y = ny; place = pl = np;
              Say("{\"placed\":{\"mode\":\"free\",\"x\":" + nx + ",\"y\":" + ny + "}}");
            }
            bool petTop = (GetWindowLong(pet, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
            if (!petTop || Math.Abs(pl.X - p.L) > 1 || Math.Abs(pl.Y - p.T) > 1)
              SetWindowPos(pet, HWND_TOPMOST, pl.X, pl.Y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
            if (onScreen) {
              IntPtr fg = GetForegroundWindow();
              bool restack = fg != lastFg || !IsAbove(new IntPtr(ringHandle), claude);
              lastFg = fg;
              PlaceRing(SlotAboveClaude(claude, pet), f, s, restack, claude);
            }
          } else if (!holding && !(dragOn && dragMoved)) {
            double cx, feet;
            Spot(f, s, place, layout, out cx, out feet);
            // Her feet stand 6 DIPs above the pet window's bottom edge (the page puts her there).
            int x = (int)Math.Round(cx - (p.R - p.L) / 2.0), y = (int)Math.Round(feet + 6 * s - (p.B - p.T));
            // Just above Claude in the window stack, as an ordinary window: whatever covers Claude
            // covers her too, at the same moment (Windows moves the other app above both of them).
            // When another window is above Claude, she goes just below it (moving down is always
            // allowed). When nothing ordinary is above Claude, as while it's the active window, she
            // goes to the top of the ordinary windows: Windows won't let a background program lift a
            // window above the active one directly, but it does let an always-on-top window drop back
            // to the top of the ordinary ones, so she's made always-on-top and dropped back at once.
            // (She used to stay always-on-top while Claude was active, and then flashed over the next
            // app for a tick or more each time you switched to it.)
            // She's restacked only when the active window changes, or when she has ended up behind
            // Claude: many apps keep extra windows (shadows, glow borders) right behind their main
            // window and restack them whenever something comes in between, so checking every tick
            // made her and the ring flash, swapping places with them 30 times a second.
            IntPtr fg = GetForegroundWindow();
            bool restack = fg != lastFg || !IsAbove(pet, claude);
            lastFg = fg;
            bool petTop = (GetWindowLong(pet, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
            // A restack done the moment another app became active can run before Windows has put that
            // app above Claude: she then went to the top and ended up above it. Check every tick that
            // she isn't above the active window while it's above Claude (or still always-on-top).
            // Her own windows, like her menu, don't count.
            if (!restack && fg != claude && fg != IntPtr.Zero) {
              uint fgPid, petPid; GetWindowThreadProcessId(fg, out fgPid); GetWindowThreadProcessId(pet, out petPid);
              if (fgPid != petPid && (petTop || IsAbove(fg, claude) && IsAbove(pet, fg))) restack = true;
            }
            IntPtr above = IntPtr.Zero; bool inPlace = true, toTop = false;
            if (restack) {
              inPlace = false;
              bool found = false;
              for (IntPtr h = GetWindow(claude, GW_HWNDPREV); h != IntPtr.Zero; h = GetWindow(h, GW_HWNDPREV)) {
                if (h == pet) { if (!petTop) { inPlace = found = true; } break; }   // already just above Claude
                if (h.ToInt32() == ringHandle) continue;   // her own rainbow ring, just below her
                if (!IsWindowVisible(h) || Cloaked(h)) continue;
                if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0) break;   // nothing ordinary above Claude
                above = h; found = true; break;
              }
              if (!found) toTop = true;
            }
            if (toTop) {
              uint flags = SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
              if (!petTop) SetWindowPos(pet, HWND_TOPMOST, x, y, 0, 0, flags);
              SetWindowPos(pet, HWND_NOTOPMOST, x, y, 0, 0, flags);
              lastX = x; lastY = y;
            } else if (!inPlace || Math.Abs(x - p.L) > 1 || Math.Abs(y - p.T) > 1) {   // where she really is (see PlaceRing)
              uint flags = SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | (inPlace ? SWP_NOZORDER : 0);
              SetWindowPos(pet, above, x, y, 0, 0, flags);
              lastX = x; lastY = y;
            }
            PlaceRing(pet, f, s, restack && !inPlace, claude);
          } else lastX = int.MinValue;
        }
      }
      Thread.Sleep(dragOn ? 12 : present ? 33 : 40);   // smoother while she's dragged
    }
  }
}
