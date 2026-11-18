"""A tiny but real agent for the motorbench server: it looks at the screenshot,
finds the blue target by colour, and points at it. Standard library only.

It handles the four tasks whose target is "the blue circle" (click, double-click,
right-click, hover), which is enough to show the whole loop from another language:
start a run, open episodes, look, act, finish, read the score.

    node bench.ts serve                                  # in one terminal
    python3 clients/python/example_agent.py              # in another
    python3 clients/python/example_agent.py --url http://host:8765 --token SECRET --seeds 3
"""
import argparse
import struct
import zlib

from motorbench import Client

TARGET_BLUE = (37, 99, 235)  # the colour the task pages use for targets


def decode_png(data):
    """Decode an 8-bit RGB or RGBA PNG into (width, height, channels, rows of bytes)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, width, height, channels = 8, [], 0, 0, 3
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type = struct.unpack(">IIBB", chunk[:10])
            assert depth == 8 and color_type in (2, 6), "expected 8-bit RGB or RGBA"
            channels = 3 if color_type == 2 else 4
        elif kind == b"IDAT":
            idat.append(chunk)
    raw = zlib.decompress(b"".join(idat))
    stride = width * channels
    rows, prev = [], bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        kind, line = raw[start], bytearray(raw[start + 1 : start + 1 + stride])
        if kind == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 255
        elif kind == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif kind == 3:  # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif kind == 4:  # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return width, height, channels, rows


def find_blue_target(png):
    """Centre of the pixels that have the target colour, or None if there are none."""
    width, height, channels, rows = decode_png(png)
    r0, g0, b0 = TARGET_BLUE
    sum_x = sum_y = count = 0
    for y in range(60, height):  # skip the instruction bar
        row = rows[y]
        for x in range(width):
            i = x * channels
            if abs(row[i] - r0) < 12 and abs(row[i + 1] - g0) < 12 and abs(row[i + 2] - b0) < 12:
                sum_x += x
                sum_y += y
                count += 1
    return (round(sum_x / count), round(sum_y / count)) if count else None


def solve(ep):
    """One look, one move. Returns False if this agent does not know the task."""
    target = find_blue_target(ep.screenshot())
    if target is None:
        return False
    x, y = target
    task = ep.task["task"]
    if task == "click":
        ep.act(type="click", x=x, y=y)
    elif task == "double-click":
        ep.act(type="click", x=x, y=y, count=2)
    elif task == "right-click":
        ep.act(type="click", x=x, y=y, button="right")
    elif task == "hover":
        ep.act_many([{"type": "move", "x": x, "y": y}, {"type": "wait", "seconds": 1.3}])
    else:
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--token", default=None)
    parser.add_argument("--tasks", default="click,double-click,right-click,hover")
    parser.add_argument("--levels", default="1,2,3")
    parser.add_argument("--seeds", type=int, default=2)
    args = parser.parse_args()

    client = Client(args.url, token=args.token)
    run = client.start_run(
        "python-blue-dot",
        tasks=args.tasks.split(","),
        levels=[int(level) for level in args.levels.split(",")],
        seeds=args.seeds,
        config={"policy": "click the centroid of the target-coloured pixels", "language": "python"},
    )
    print(f"run {run.id}: {len(run.episodes)} episodes")
    for spec in run.episodes:
        ep = run.open(spec)
        solve(ep)
        result = ep.finish()
        mark = "PASS" if result["success"] else "fail"
        print(f"  {spec['task']:<13} L{spec['level']} s{spec['seed']}  score {result['score']:.3f} {mark}  ({result['endedBy']})")
    summary = run.finish()
    print(f"score {summary['score'] * 100:.1f}  pass {summary['success'] * 100:.1f}%  over {summary['episodes']} episodes")
    print(f"report: {client.url(summary['reportUrl'])}")


if __name__ == "__main__":
    main()
