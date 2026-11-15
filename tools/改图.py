#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
改图：把一张图摆进固定的画面框（默认 1104×621），拖动 / 缩放 / 裁切，导出成正好这个尺寸的 PNG。

用法
----
  双击「改图.cmd」，或者命令行：python 改图.py [图片] [--宽 1104 --高 621]

  · 打开图片（Ctrl+O），也可以直接把图片从资源管理器拖进窗口
  · 左键拖动 = 挪位置；滚轮 = 缩放（以鼠标那一点为中心）
  · 方向键 = 挪 1 像素，Shift+方向键 = 挪 10 像素
  · F 适应画面　H 适应高度　W 适应宽度　1 = 原大小　G 居中　C 参考线
  · 画面框外面那圈会变暗：那里是会被裁掉的部分，方便你把半身摆进框里
  · Ctrl+S 导出 PNG（默认 1104×621，背景可选透明 / 纯色）

只用到 Pillow 和 tkinter，不联网、不调用任何模型。
"""

import os
import sys
import time
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from PIL import Image, ImageOps, ImageTk

OUT_W, OUT_H = 1104, 621      # 默认输出尺寸（这个游戏的分辨率）
PAD = 70                      # 画面框外面留一圈，能看见被裁掉的部分
CHECK = 12                    # 棋盘格大小（表示透明）


# ---------------------------------------------------------------- 纯函数：合成
def resize_to(img, scale):
    """按比例缩放（保证宽高都不小于 1 像素）"""
    w = max(1, int(round(img.width * scale)))
    h = max(1, int(round(img.height * scale)))
    return img if (w, h) == img.size else img.resize((w, h), Image.LANCZOS)


def compose(src, scale, cx, cy, W, H, bg=None):
    """把 src 缩放后，以 (cx, cy) 为中心贴进 W×H 的画面；超出的部分裁掉"""
    out = Image.new("RGBA", (W, H), bg if bg else (0, 0, 0, 0))
    if src is None:
        return out
    img = resize_to(src, scale)
    x = int(round(cx - img.width / 2.0))
    y = int(round(cy - img.height / 2.0))
    left, top = max(0, x), max(0, y)
    right, bottom = min(W, x + img.width), min(H, y + img.height)
    if right <= left or bottom <= top:
        return out
    part = img.crop((left - x, top - y, right - x, bottom - y))
    out.alpha_composite(part, (left, top))
    return out


def checker(size, cell=CHECK, a=(58, 58, 62, 255), b=(44, 44, 48, 255)):
    """透明的棋盘格底"""
    w, h = size
    img = Image.new("RGBA", (w, h), a)
    px = img.load()
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if ((x // cell) + (y // cell)) % 2:
                for yy in range(y, min(y + cell, h)):
                    for xx in range(x, min(x + cell, w)):
                        px[xx, yy] = b
    return img


# ---------------------------------------------------------------- 窗口
class App:
    def __init__(self, root, path=None, W=OUT_W, H=OUT_H):
        self.root = root
        self.W, self.H = W, H
        self.src = None            # 原图（RGBA）
        self.scale = 1.0           # 1.0 = 原图像素
        self.cx, self.cy = W / 2.0, H / 2.0     # 图中心在画面里的位置
        self.z = 1.0               # 显示缩放（画面像素 → 屏幕像素）
        self.pad = PAD
        self.bgmode = "透明"
        self.guides = False
        self._photo = None
        self._checker = None
        self._dragging = None

        root.title("改图 · 输出 %d×%d" % (W, H))
        self._ui()
        self._size_window()
        self._fit_zoom()
        self._draw_all()
        if path:
            self.load(path)

    # ---------------- 界面 ----------------
    def _ui(self):
        bar = ttk.Frame(self.root, padding=(10, 8, 10, 4))
        bar.pack(side="top", fill="x")

        ttk.Button(bar, text="打开图片…", command=self.open_dialog).pack(side="left")
        ttk.Button(bar, text="导出 PNG…", command=self.export_dialog).pack(side="left", padx=(6, 14))

        ttk.Label(bar, text="画面").pack(side="left")
        self.var_w = tk.StringVar(value=str(self.W))
        self.var_h = tk.StringVar(value=str(self.H))
        e1 = ttk.Entry(bar, width=6, textvariable=self.var_w)
        e2 = ttk.Entry(bar, width=6, textvariable=self.var_h)
        e1.pack(side="left", padx=(4, 2)); ttk.Label(bar, text="×").pack(side="left"); e2.pack(side="left", padx=(2, 6))
        for e in (e1, e2):
            e.bind("<Return>", lambda _e: self.apply_size())
        ttk.Button(bar, text="应用", command=self.apply_size).pack(side="left", padx=(0, 14))

        ttk.Label(bar, text="缩放").pack(side="left")
        self.var_scale = tk.StringVar(value="100")
        es = ttk.Entry(bar, width=6, textvariable=self.var_scale)
        es.pack(side="left", padx=(4, 0)); ttk.Label(bar, text="%").pack(side="left", padx=(0, 6))
        es.bind("<Return>", lambda _e: self.apply_scale_entry())

        for text, fn in (("适应画面", self.fit_all), ("适应高度", self.fit_h), ("原大小", self.at_100), ("居中", self.center)):
            ttk.Button(bar, text=text, command=fn).pack(side="left", padx=(6, 0))

        bar2 = ttk.Frame(self.root, padding=(10, 0, 10, 6))
        bar2.pack(side="top", fill="x")
        ttk.Label(bar2, text="背景").pack(side="left")
        self.var_bg = tk.StringVar(value=self.bgmode)
        cb = ttk.Combobox(bar2, width=6, state="readonly", values=["透明", "白色", "黑色"], textvariable=self.var_bg)
        cb.pack(side="left", padx=(4, 12))
        cb.bind("<<ComboboxSelected>>", lambda _e: self.set_bg())
        ttk.Button(bar2, text="参考线", command=self.toggle_guides).pack(side="left")
        ttk.Label(bar2, text="把图片拖进窗口 · 左键拖动 · 滚轮缩放 · 方向键微调 · F 适应 · Ctrl+S 导出",
                  foreground="#777").pack(side="left", padx=(14, 0))

        self.canvas = tk.Canvas(self.root, highlightthickness=0, background="#1b1b1f")
        self.canvas.pack(side="top", fill="both", expand=True, padx=10, pady=(0, 4))

        self.status = ttk.Label(self.root, text="还没打开图片", padding=(12, 4), foreground="#888")
        self.status.pack(side="bottom", fill="x")

        c = self.canvas
        c.bind("<ButtonPress-1>", self.on_press)
        c.bind("<B1-Motion>", self.on_drag)
        c.bind("<ButtonRelease-1>", lambda _e: setattr(self, "_dragging", None))
        c.bind("<MouseWheel>", self.on_wheel)
        c.bind("<Motion>", self.on_motion)
        self.root.bind("<Control-o>", lambda _e: self.open_dialog())
        self.root.bind("<Control-s>", lambda _e: self.export_dialog())
        self.root.bind("<Control-S>", lambda _e: self.export_dialog())
        for key, fn in (("f", self.fit_all), ("h", self.fit_h), ("w", self.fit_w), ("g", self.center), ("1", self.at_100), ("c", self.toggle_guides)):
            self.root.bind("<KeyPress-%s>" % key, lambda _e, fn=fn: fn())
        for key in ("Left", "Right", "Up", "Down"):
            self.root.bind("<KeyPress-%s>" % key, self.on_arrow)
            self.root.bind("<Shift-KeyPress-%s>" % key, self.on_arrow)
        self.root.bind("<Escape>", lambda _e: self.root.destroy())

    # ---------------- 计算 ----------------
    def _size_window(self):
        """先把窗口摆好（不超出屏幕），后面按画布实际大小算缩放"""
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        ww = min(sw - 60, 1500)
        wh = min(sh - 90, 1000)
        x = max(0, (sw - ww) // 2)
        y = max(0, (sh - wh) // 2 - 10)
        self.root.geometry("%dx%d+%d+%d" % (ww, wh, x, y))
        self.root.update_idletasks()

    def _fit_zoom(self):
        # 按画布实际能用的地方算：装不下就整体缩小，保证画面外那圈不顶出去
        cw = self.canvas.winfo_width()
        ch = self.canvas.winfo_height()
        if cw < 50 or ch < 50:
            sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
            cw, ch = sw - 80, sh - 320
        z = min(1.0, (cw - 2 * self.pad) / float(self.W), (ch - 2 * self.pad) / float(self.H))
        self.z = max(0.15, z)

    def _canvas_pos(self, x, y):
        """画面坐标 → 画布坐标"""
        return self.pad + x * self.z, self.pad + y * self.z

    def _out_pos(self, x, y):
        """画布坐标 → 画面坐标"""
        return (x - self.pad) / self.z, (y - self.pad) / self.z

    # ---------------- 画 ----------------
    def _draw_all(self):
        c = self.canvas
        cw = int(round(self.W * self.z)) + 2 * self.pad
        ch = int(round(self.H * self.z)) + 2 * self.pad
        c.configure(width=cw, height=ch)
        c.delete("all")
        # 棋盘格（只在画面框里）
        fw, fh = int(round(self.W * self.z)), int(round(self.H * self.z))
        self._checker = ImageTk.PhotoImage(checker((max(1, fw), max(1, fh))))
        c.create_image(self.pad, self.pad, image=self._checker, anchor="nw", tags="bg")
        # 图
        self._photo = None
        self._img_item = c.create_image(self.pad, self.pad, anchor="nw", tags="photo")
        # 画面框外面压暗
        self._frame_rects()
        c.create_rectangle(self.pad, self.pad, self.pad + fw, self.pad + fh, outline="#7f8aa3", width=2, tags="frame")
        self._guides = []
        self._draw_guides()
        self._update_image()

    def _frame_rects(self):
        c = self.canvas
        fw, fh = int(round(self.W * self.z)), int(round(self.H * self.z))
        x0, y0 = self.pad, self.pad
        x1, y1 = x0 + fw, y0 + fh
        cw = int(c.winfo_reqwidth()); ch = int(c.winfo_reqheight())
        for box in ((0, 0, cw, y0), (0, y1, cw, ch), (0, y0, x0, y1), (x1, y0, cw, y1)):
            if box[2] > box[0] and box[3] > box[1]:
                c.create_rectangle(*box, fill="#000000", outline="", stipple="gray50", tags="dim")

    def _draw_guides(self):
        c = self.canvas
        for i in self._guides:
            c.delete(i)
        self._guides = []
        if not self.guides:
            return
        fw, fh = int(round(self.W * self.z)), int(round(self.H * self.z))
        x0, y0 = self.pad, self.pad
        for x in (x0 + fw / 3.0, x0 + fw / 2.0, x0 + 2 * fw / 3.0):
            self._guides.append(c.create_line(x, y0, x, y0 + fh, fill="#ffffff", dash=(3, 5), stipple="gray50"))
        for y in (y0 + fh / 3.0, y0 + fh / 2.0, y0 + 2 * fh / 3.0):
            self._guides.append(c.create_line(x0, y, x0 + fw, y, fill="#ffffff", dash=(3, 5), stipple="gray50"))

    def _update_image(self):
        c = self.canvas
        if self.src is None:
            c.itemconfigure(self._img_item, image="")
            self._status()
            return
        disp_scale = self.scale * self.z
        img = resize_to(self.src, disp_scale)
        self._photo = ImageTk.PhotoImage(img)
        x, y = self._canvas_pos(self.cx - (self.src.width * self.scale) / 2.0,
                                self.cy - (self.src.height * self.scale) / 2.0)
        c.itemconfigure(self._img_item, image=self._photo)
        c.coords(self._img_item, x, y)
        # 图要在「压暗」层下面：把 photo 提到 bg 之上、dim 之下
        c.tag_raise(self._img_item, "bg")
        for i in c.find_withtag("dim"):
            c.tag_raise(i, self._img_item)
        c.tag_raise("frame")
        for i in self._guides:
            c.tag_raise(i)
        self._status()

    def _status(self):
        if self.src is None:
            self.status.configure(text="还没打开图片　·　把图片拖进来，或者点「打开图片…」")
            return
        w = int(round(self.src.width * self.scale)); h = int(round(self.src.height * self.scale))
        self.var_scale.set(str(int(round(self.scale * 100))))
        self.status.configure(
            text="原图 %d×%d　→　现在 %d×%d（%.0f%%）　·　左上角在 (%d, %d)　·　输出 %d×%d"
                 % (self.src.width, self.src.height, w, h, self.scale * 100,
                    int(round(self.cx - w / 2.0)), int(round(self.cy - h / 2.0)), self.W, self.H))

    # ---------------- 操作 ----------------
    def load(self, path):
        try:
            img = Image.open(path)
            img = ImageOps.exif_transpose(img)
            self.src = img.convert("RGBA")
        except Exception as e:
            messagebox.showerror("打不开", "%s\n\n%s" % (path, e))
            return
        self.path = path
        self.fit_all(first=True)
        self._status()

    def open_dialog(self):
        p = filedialog.askopenfilename(title="打开图片",
                                       filetypes=[("图片", "*.png *.jpg *.jpeg *.webp *.bmp *.gif"), ("所有文件", "*.*")])
        if p:
            self.load(p)

    def drop_paths(self, paths):
        """从资源管理器拖进来的文件：打开第一个能读的，其余只提示。"""
        good = [p for p in (paths or []) if os.path.isfile(p)]
        if not good:
            return
        self.load(good[0])
        if len(good) > 1:
            self.status.configure(text="拖进来 %d 个文件，先打开第一个：%s" % (len(good), os.path.basename(good[0])))

    def export_dialog(self):
        if self.src is None:
            messagebox.showinfo("还没有图", "先打开一张图片。")
            return
        name = os.path.splitext(os.path.basename(getattr(self, "path", "改图")))[0]
        p = filedialog.asksaveasfilename(title="导出", defaultextension=".png",
                                         initialfile="%s_%dx%d.png" % (name, self.W, self.H),
                                         filetypes=[("PNG", "*.png")])
        if not p:
            return
        bg = {"透明": None, "白色": (255, 255, 255, 255), "黑色": (0, 0, 0, 255)}[self.var_bg.get()]
        out = compose(self.src, self.scale, self.cx, self.cy, self.W, self.H, bg)
        try:
            out.save(p)
        except Exception as e:
            messagebox.showerror("存不了", "%s\n\n%s" % (p, e))
            return
        self.status.configure(text="已导出：%s（%d×%d）" % (p, self.W, self.H))

    def apply_size(self):
        try:
            w, h = int(self.var_w.get()), int(self.var_h.get())
            if not (16 <= w <= 4096 and 16 <= h <= 4096):
                raise ValueError
        except ValueError:
            messagebox.showerror("尺寸不对", "宽高要在 16~4096 之间。")
            self.var_w.set(str(self.W)); self.var_h.set(str(self.H))
            return
        self.W, self.H = w, h
        self.root.title("改图 · 输出 %d×%d" % (w, h))
        self.cx = min(max(self.cx, 0), w); self.cy = min(max(self.cy, 0), h)
        self._fit_zoom()
        self._draw_all()

    def apply_scale_entry(self):
        try:
            v = float(self.var_scale.get()) / 100.0
            if not (0.01 <= v <= 40):
                raise ValueError
        except ValueError:
            messagebox.showerror("缩放不对", "缩放百分比要在 1~4000 之间。")
            self._status()
            return
        self.set_scale(v)

    def set_scale(self, scale, anchor=None):
        if self.src is None:
            return
        scale = min(max(scale, 0.01), 40.0)
        if anchor:
            ax, ay = anchor
            lx = self.cx - self.src.width * self.scale / 2.0
            ly = self.cy - self.src.height * self.scale / 2.0
            sx = (ax - lx) / self.scale
            sy = (ay - ly) / self.scale
            self.cx = ax - sx * scale + self.src.width * scale / 2.0
            self.cy = ay - sy * scale + self.src.height * scale / 2.0
        self.scale = scale
        self._update_image()

    def fit_all(self, first=False):
        if self.src is None:
            return
        s = min(self.W / float(self.src.width), self.H / float(self.src.height)) * (0.98 if not first else 1.0)
        self.scale = s
        self.cx, self.cy = self.W / 2.0, self.H / 2.0
        self._update_image()

    def fit_h(self):
        if self.src is None:
            return
        self.scale = self.H / float(self.src.height)
        self.cx = self.W / 2.0
        self._update_image()

    def fit_w(self):
        if self.src is None:
            return
        self.scale = self.W / float(self.src.width)
        self.cy = self.H / 2.0
        self._update_image()

    def at_100(self):
        self.set_scale(1.0)

    def center(self):
        self.cx, self.cy = self.W / 2.0, self.H / 2.0
        self._update_image()

    def set_bg(self):
        self.bgmode = self.var_bg.get()
        # 只有导出时才真正用颜色；画面上一直是棋盘格

    def toggle_guides(self):
        self.guides = not self.guides
        self._draw_guides()
        self._update_image()

    # ---------------- 鼠标 / 键盘 ----------------
    def on_press(self, e):
        self._dragging = (e.x, e.y)

    def on_drag(self, e):
        if not self._dragging or self.src is None:
            return
        dx = (e.x - self._dragging[0]) / self.z
        dy = (e.y - self._dragging[1]) / self.z
        self._dragging = (e.x, e.y)
        self.cx += dx; self.cy += dy
        self._update_image()

    def on_wheel(self, e):
        if self.src is None:
            return
        step = 1.1 if e.delta > 0 else 1 / 1.1
        ax, ay = self._out_pos(e.x, e.y)
        self.set_scale(self.scale * step, anchor=(ax, ay))

    def on_motion(self, e):
        if self.src is None:
            return
        x, y = self._out_pos(e.x, e.y)
        w = int(round(self.src.width * self.scale)); h = int(round(self.src.height * self.scale))
        self.status.configure(
            text="原图 %d×%d　→　现在 %d×%d（%.0f%%）　·　左上角在 (%d, %d)　·　鼠标 (%d, %d)　·　输出 %d×%d"
                 % (self.src.width, self.src.height, w, h, self.scale * 100,
                    int(round(self.cx - w / 2.0)), int(round(self.cy - h / 2.0)),
                    int(round(x)), int(round(y)), self.W, self.H))

    def on_arrow(self, e):
        if self.src is None:
            return
        step = 10 if (e.state & 0x0001) else 1
        if e.keysym == "Left":
            self.cx -= step
        elif e.keysym == "Right":
            self.cx += step
        elif e.keysym == "Up":
            self.cy -= step
        elif e.keysym == "Down":
            self.cy += step
        self._update_image()


def dpi_aware():
    """让 Windows 不要按 125% / 150% 缩放这个窗口（不然画面会被放大，装不下）"""
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)     # 系统 DPI 感知
        return True
    except Exception:
        try:
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
            return True
        except Exception:
            return False


def _drop_log(msg):
    """拖放出问题时留个记录：%TEMP%\\改图-拖放.log（正常用不到，出问题才看）。"""
    try:
        import tempfile
        with open(os.path.join(tempfile.gettempdir(), "改图-拖放.log"), "a", encoding="utf-8") as f:
            f.write("%s  %s\n" % (time.strftime("%H:%M:%S"), msg))
    except Exception:
        pass


def enable_drop(root, on_paths):
    """把文件从资源管理器直接拖进窗口（Windows 的 WM_DROPFILES）。

    要点（踩过的坑）：
      · 窗口过程里**不碰 Tk** —— 拖放时 Tk 正停在自己的消息循环里，从窗口过程回调 Tcl 会崩；
        这里只把路径塞进队列，由 Tk 自己的 after 循环取出来再打开。
      · 先读出旧的窗口过程、存好，再把新的挂上去，避免中间来一条消息时旧指针还是空的。
      · 整个窗口过程用 try 包住，出任何事都退回老过程，绝不让异常穿过 ctypes。

    挂不上（非 Windows、权限、别的工具也挂过）就返回 False，其它功能照常用。
    """
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        shell32 = ctypes.windll.shell32
        WM_DROPFILES = 0x0233
        GWLP_WNDPROC = -4
        GA_ROOT = 2

        shell32.DragQueryFileW.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]
        shell32.DragQueryFileW.restype = wintypes.UINT
        shell32.DragFinish.argtypes = [wintypes.HANDLE]
        shell32.DragFinish.restype = None
        user32.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT,
                                           wintypes.WPARAM, wintypes.LPARAM]
        user32.CallWindowProcW.restype = ctypes.c_longlong
        user32.GetParent.argtypes = [wintypes.HWND]
        user32.GetParent.restype = wintypes.HWND
        user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        user32.GetAncestor.restype = wintypes.HWND
        shell32.DragAcceptFiles.argtypes = [wintypes.HWND, wintypes.BOOL]
        shell32.DragAcceptFiles.restype = None
        getter = getattr(user32, "GetWindowLongPtrW", None) or user32.GetWindowLongW
        getter.argtypes = [wintypes.HWND, ctypes.c_int]
        getter.restype = ctypes.c_void_p
        setter = getattr(user32, "SetWindowLongPtrW", None) or user32.SetWindowLongW
        setter.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
        setter.restype = ctypes.c_void_p

        root.update_idletasks()
        child = root.winfo_id()
        hwnd = user32.GetAncestor(child, GA_ROOT) or user32.GetParent(child) or child
        # 只挂在自己这个窗口上（挂错窗口是致命的）
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        user32.GetClassNameW(hwnd, cls, 64)
        if not cls.value.startswith("Tk"):
            _drop_log("窗口类不是 Tk（%r），放弃挂拖放" % cls.value)
            return False
        old = getter(wintypes.HWND(hwnd), GWLP_WNDPROC)
        if not old:
            _drop_log("读不到旧的窗口过程，放弃挂拖放")
            return False

        WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_longlong, wintypes.HWND, wintypes.UINT,
                                     wintypes.WPARAM, wintypes.LPARAM)
        state = {"old": old, "proc": None, "drop": []}

        def _proc(h, msg, wp, lp):
            try:
                if msg == WM_DROPFILES:
                    if wp:
                        total = int(shell32.DragQueryFileW(wp, 0xFFFFFFFF, None, 0))
                        files = []
                        for i in range(min(total, 16)):
                            ln = int(shell32.DragQueryFileW(wp, i, None, 0))
                            if ln <= 0:
                                continue
                            buf = ctypes.create_unicode_buffer(ln + 1)
                            shell32.DragQueryFileW(wp, i, buf, ln + 1)
                            if buf.value:
                                files.append(buf.value)
                        shell32.DragFinish(wp)
                        if files:
                            state["drop"].extend(files)   # 只入队，不在这里碰 Tk
                            _drop_log("收到拖放 %d 个：%s" % (len(files), files[0]))
                    return 0
            except Exception as e:
                _drop_log("处理拖放出错：%r" % (e,))
            try:
                return user32.CallWindowProcW(state["old"], h, msg, wp, lp)
            except Exception:
                return 0

        proc = WNDPROC(_proc)
        state["proc"] = proc                     # 留住引用，别被回收
        enablers.append(state)
        setter(wintypes.HWND(hwnd), GWLP_WNDPROC, ctypes.cast(proc, ctypes.c_void_p))
        shell32.DragAcceptFiles(wintypes.HWND(hwnd), True)
        _drop_log("挂上拖放：hwnd=%s" % hwnd)

        def _pump():
            # 在 Tk 自己的循环里取队列 —— 打开图片、弹提示都只在这里做
            try:
                if state["drop"]:
                    paths = state["drop"][:]
                    del state["drop"][:]
                    _drop_log("打开：%s" % (paths[0] if paths else "")) 
                    on_paths(paths)
            except Exception as e:
                _drop_log("打开拖进来的文件失败：%r" % (e,))
            try:
                root.after(120, _pump)
            except Exception:
                pass

        root.after(120, _pump)
        return True
    except Exception as e:
        _drop_log("挂拖放失败：%r" % (e,))
        return False


enablers = []


def main():
    import argparse
    ap = argparse.ArgumentParser(description="把图片摆进固定画面框（默认 1104×621）再导出")
    ap.add_argument("image", nargs="?", help="要打开的图片")
    ap.add_argument("--宽", "--width", dest="w", type=int, default=OUT_W)
    ap.add_argument("--高", "--height", dest="h", type=int, default=OUT_H)
    a = ap.parse_args()
    dpi_aware()
    root = tk.Tk()
    try:   # 让字号跟着系统缩放走（DPI 感知以后字会偏小）
        root.tk.call("tk", "scaling", root.winfo_fpixels("1i") / 72.0)
    except Exception:
        pass
    root.minsize(680, 420)
    app = App(root, a.image, a.w, a.h)
    # 等窗口彻底建好、Tk 空闲了再挂拖放（不要在启动过程中去改窗口过程）
    root.after(300, lambda: enable_drop(root, app.drop_paths))
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
