#!/usr/bin/env python3
"""Migrate `new Text({ text, style: { fontSize, fill, ... } })` to
`criarText(text, fontSize, fill)` across M8 consumer files.

Handles both single-line and multi-line forms. Idempotent — already-
migrated files are skipped (no `new Text` matches left to replace).
"""
import re
import sys

FILES = ['src/ui/painel.ts', 'src/ui/selecao.ts', 'src/ui/tutorial.ts']

# Multi-line tolerant. `fontSize:` and `fill:` may appear on the same
# line or on separate lines inside the style block. We anchor on
# `new Text({` opener + `})` closer and let `[^}]` span the style body.
# The fill value can be an identifier (SP.statCyan) or a hex literal
# (0xff8040) — `[^,}]+` covers both as long as the call site doesn't
# have a comma in the color expression.
PAT = re.compile(
    r"new Text\(\{\s*\n?\s*"
    r"text:\s*"
    r"(?P<text>(?:\"[^\"]*\"|'[^']*'|`[^`]*`|[A-Za-z_][A-Za-z0-9_.]*))"
    r"\s*,\s*\n?\s*"
    r"style:\s*\{"
    r"[^}]*?fontSize:\s*(?P<fs>\d+)"
    r"[^}]*?fill:\s*(?P<fill>[^,}]+)"
    r"[^}]*?\}"
    r"[\s\S]*?\)\;?",
    re.DOTALL,
)


def main() -> int:
    total = 0
    for path in FILES:
        with open(path) as fh:
            src = fh.read()
        matches = PAT.findall(src)
        if not matches:
            print(f'  skip: {path} (no matches)')
            continue

        def repl(m: re.Match[str]) -> str:
            text = m.group('text')
            fs = m.group('fs')
            fill = m.group('fill').strip()
            return f'criarText({text}, {fs}, {fill})'

        out = PAT.sub(repl, src)
        with open(path, 'w') as fh:
            fh.write(out)
        n = len(matches)
        total += n
        print(f'  wrote: {path} ({n} replacements)')
    print(f'Total: {total} replacements across {len(FILES)} files')
    return 0


if __name__ == '__main__':
    sys.exit(main())
