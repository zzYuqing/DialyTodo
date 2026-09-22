"""
桌宠素材：白底转透明（零第三方依赖，仅用 Python 标准库 zlib / struct）。

背景来自 AI 出图的纯白画布。机身是米白 #f0efe6，与白底 #ffffff 仅差约 15 个色阶，
简单阈值会把机身一起吃掉，因此采用「从四边出发的漫水填充」判定背景：
只有与画框边缘连通的近白像素才算背景；屏脸高光、头顶高光虽然也白，但不连通，安全保留。

边缘做两级 alpha 羽化（紧贴背景 1px -> 200，第二层 -> 235），
避免硬锯齿在深色壁纸上形成台阶。注意羽化只降 alpha、不改 RGB，
深色边缘在深色壁纸上会变淡而不会泛白。

用法：
    python remove_bg.py <输入.png> <输出.png>
"""

import struct
import sys
import zlib
from collections import deque

# --- 判定参数（可调） ---
# 与纯白的曼哈顿色差，低于此值视为「近白」
BG_TOLERANCE = 70
# 羽化 alpha
FEATHER_1 = 200
FEATHER_2 = 235


def read_png(path):
    """解码 PNG -> (width, height, channels, bytearray 原始像素)"""
    with open(path, "rb") as f:
        data = f.read()

    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是合法的 PNG 文件")

    pos = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()

    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length

        if ctype == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", body[:10])
        elif ctype == b"IDAT":
            idat.extend(body)
        elif ctype == b"IEND":
            break

    if bit_depth != 8:
        raise ValueError(f"只支持 8 位深，当前为 {bit_depth}")
    if color_type not in (2, 6):
        raise ValueError(f"只支持 RGB(2)/RGBA(6)，当前为 {color_type}")

    channels = 4 if color_type == 6 else 3
    raw = zlib.decompress(bytes(idat))
    stride = width * channels

    out = bytearray(height * stride)
    prev = bytearray(stride)
    p = 0

    for y in range(height):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride

        if ft == 0:
            pass
        elif ft == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        else:
            raise ValueError(f"未知 filter 类型 {ft}")

        out[y * stride:(y + 1) * stride] = line
        prev = line

    return width, height, channels, out


def write_png(path, width, height, rgba):
    """编码 RGBA 像素 -> PNG（filter 全 0，压缩级别 9）"""
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def build_background_mask(width, height, channels, px):
    """从四边近白像素漫水填充，返回背景掩码 bytearray(1=背景)"""
    stride = width * channels
    mask = bytearray(width * height)

    def is_near_white(idx):
        o = idx * channels
        r, g, b = px[o], px[o + 1], px[o + 2]
        return (255 - r) + (255 - g) + (255 - b) < BG_TOLERANCE

    q = deque()
    for x in range(width):
        for y in (0, height - 1):
            idx = y * width + x
            if not mask[idx] and is_near_white(idx):
                mask[idx] = 1
                q.append(idx)
    for y in range(height):
        for x in (0, width - 1):
            idx = y * width + x
            if not mask[idx] and is_near_white(idx):
                mask[idx] = 1
                q.append(idx)

    while q:
        idx = q.popleft()
        y, x = divmod(idx, width)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                nidx = ny * width + nx
                if not mask[nidx] and is_near_white(nidx):
                    mask[nidx] = 1
                    q.append(nidx)

    return mask


def feather(width, height, mask):
    """计算羽化 alpha：紧贴背景 1px -> FEATHER_1，第二层 -> FEATHER_2，其余 255"""
    alpha = bytearray(255 for _ in range(width * height))
    for i in range(width * height):
        if mask[i]:
            alpha[i] = 0

    edge1 = []
    for y in range(height):
        for x in range(width):
            i = y * width + x
            if mask[i]:
                continue
            for nx in (x - 1, x + 1):
                if 0 <= nx < width and mask[y * width + nx]:
                    edge1.append(i)
                    break
            else:
                for ny in (y - 1, y + 1):
                    if 0 <= ny < height and mask[ny * width + x]:
                        edge1.append(i)
                        break

    for i in edge1:
        alpha[i] = FEATHER_1

    edge2 = []
    for i in edge1:
        y, x = divmod(i, width)
        for ny in range(max(0, y - 1), min(height, y + 2)):
            for nx in range(max(0, x - 1), min(width, x + 2)):
                j = ny * width + nx
                if not mask[j] and alpha[j] == 255:
                    edge2.append(j)
    for j in edge2:
        alpha[j] = FEATHER_2

    return alpha


def trim_to_content(width, height, channels, px, alpha):
    """裁掉四周全透明留白，返回 (新尺寸, 新像素, 新 alpha)"""
    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        row = y * width
        for x in range(width):
            if alpha[row + x]:
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y

    if max_x < 0:
        raise ValueError("整张图都被判成背景了，请调大 BG_TOLERANCE")

    nw, nh = max_x - min_x + 1, max_y - min_y + 1
    out_px = bytearray(nw * nh * 4)
    out_a = bytearray(nw * nh)
    for y in range(nh):
        src = (y + min_y) * width + min_x
        dst = y * nw
        for x in range(nw):
            o = (src + x) * channels
            d = (dst + x) * 4
            out_px[d] = px[o]
            out_px[d + 1] = px[o + 1]
            out_px[d + 2] = px[o + 2]
            out_px[d + 3] = alpha[src + x]
            out_a[dst + x] = alpha[src + x]
    return nw, nh, out_px, out_a


def main():
    if len(sys.argv) < 3:
        print("用法: python remove_bg.py <输入.png> <输出.png>")
        sys.exit(1)

    src, dst = sys.argv[1], sys.argv[2]
    w, h, ch, px = read_png(src)
    print(f"读取: {w}x{h}, {ch} 通道")

    mask = build_background_mask(w, h, ch, px)
    bg_count = sum(mask)
    print(f"背景像素: {bg_count} / {w * h} ({bg_count * 100 // (w * h)}%)")

    alpha = feather(w, h, mask)
    nw, nh, out_px, out_a = trim_to_content(w, h, ch, px, alpha)
    print(f"裁剪后: {nw}x{nh}")

    write_png(dst, nw, nh, out_px)
    print(f"已写出: {dst}")


if __name__ == "__main__":
    main()
