#!/usr/bin/env python3
"""Migrate `new Text({ text, style: { fontSize, fill, ... } })` to
`criarText(text, fontSize, fill)` across M8 consumer files.
"""
import re
import sys

FILES = ['src/ui/painel.ts', 'src/ui/selecao.ts', 'src/ui/tutorial.ts']

# Captures:
#   - text: quoted string OR a JS identifier (var name) OR template literal
#   - fs: fontSize integer
#   - fill: identifier or hex literal (e.g. SP.statCyan or 0xff8040)
#
# The pattern matches the `new Text({` opener, then a multi-line
# `text: ... ,` clause, then a multi-line `style: { ... fontSize: N ...
# fill: X ... }` block, then a flexible closing `}` (followed by
# optional whitespace + `)` of the new Text call, but we only need
# to match up to the end of the style block to replace the whole
# `new Text({...})` correctly).
PAT = re.compile(
    r"new Text\(\{"                       # `new Text({`
    r"\s*text:\s*"
    r"(?P<text>(?:\"[^\"]*\"|'[^']*'|`[^`]*`|[A-Za-z_][A-Za-z0-9_]*))"
    r"\s*,\s*style:\s*\{"
    r"[^}]*?fontSize:\s*(?P<fs>\d+)"
    r"[^}]*?fill:\s*(?P<fill>[^,}]+)"
    r"[^}]*?\}"
    r"\s*\)",                                # `})` close
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

        def repl(m):
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
