import { Fragment, type ReactNode } from "react";
import { Linking, StyleSheet, Text as RNText, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fontSize } from "@/theme/colors";

/**
 * A small Markdown renderer for course content: descriptions, pages,
 * announcements, instructions, feedback and discussion posts.
 *
 * Covers what teachers write in the web editor - headings, paragraphs,
 * bold/italic/strike/code, links, bulleted and numbered lists, block quotes,
 * fenced code, rules and simple tables. Raw HTML is shown as text, never
 * interpreted. Written here rather than pulled in as a dependency: the
 * available React Native Markdown packages lag the React Native version.
 */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; blocks: Block[] }
  | { type: "code"; text: string }
  | { type: "rule" }
  | { type: "table"; header: string[]; rows: string[][] };

interface ListItem {
  text: string;
  depth: number;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code.
    if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      i++;
      continue;
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEP_RE.test(lines[i + 1])
    ) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const first = LIST_RE.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]);
      const start = ordered ? parseInt(first[2], 10) || 1 : 1;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        // A top-level switch between bullets and numbers starts a new list.
        if (m && !m[1] && /\d/.test(m[2]) !== ordered) break;
        if (m) {
          items.push({
            text: m[3],
            depth: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)),
          });
          i++;
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          // A wrapped continuation line belongs to the item above.
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) &&
      !LIST_RE.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: para.join(" ") });
  }

  return blocks;
}

type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "strike"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

const INLINE_RE =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\s][\s\S]*?)\*|_([^_\s][\s\S]*?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push({ type: "text", text: rest });
      break;
    }
    // snake_case is not emphasis: an underscore inside a word stays text.
    if (m[7] !== undefined && m.index > 0 && /\w/.test(rest[m.index - 1])) {
      out.push({ type: "text", text: rest.slice(0, m.index + 1) });
      rest = rest.slice(m.index + 1);
      continue;
    }
    if (m.index > 0) out.push({ type: "text", text: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ type: "code", text: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined)
      out.push({ type: "strong", children: parseInline(m[3] ?? m[4]) });
    else if (m[5] !== undefined)
      out.push({ type: "strike", children: parseInline(m[5]) });
    else if (m[6] !== undefined || m[7] !== undefined)
      out.push({ type: "em", children: parseInline(m[6] ?? m[7]) });
    else if (m[8] !== undefined)
      out.push({ type: "link", href: m[9], children: parseInline(m[8]) });
    else if (m[10] !== undefined)
      out.push({
        type: "link",
        href: m[10],
        children: [{ type: "text", text: m[10] }],
      });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** Only web links open; anything else (javascript:, file:) stays text. */
function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  const { colors } = useTheme();
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>;
          case "strong":
            return (
              <RNText key={i} style={{ fontWeight: "700" }}>
                <InlineNodes nodes={n.children} />
              </RNText>
            );
          case "em":
            return (
              <RNText key={i} style={{ fontStyle: "italic" }}>
                <InlineNodes nodes={n.children} />
              </RNText>
            );
          case "strike":
            return (
              <RNText key={i} style={{ textDecorationLine: "line-through" }}>
                <InlineNodes nodes={n.children} />
              </RNText>
            );
          case "code":
            return (
              <RNText
                key={i}
                style={{
                  fontFamily: "Menlo",
                  backgroundColor: colors.muted,
                  fontSize: fontSize.sm,
                }}
              >
                {n.text}
              </RNText>
            );
          case "link": {
            const href = safeHref(n.href);
            return (
              <RNText
                key={i}
                style={
                  href
                    ? { textDecorationLine: "underline", color: colors.chart3 }
                    : undefined
                }
                onPress={
                  href ? () => void Linking.openURL(href).catch(() => {}) : undefined
                }
              >
                <InlineNodes nodes={n.children} />
              </RNText>
            );
          }
        }
      })}
    </>
  );
}

const HEADING_SIZE = [0, 22, 20, 18, 17, 16, 15];

function BlockView({
  block,
  baseSize,
  color,
}: {
  block: Block;
  baseSize: number;
  color: string;
}): ReactNode {
  const { colors } = useTheme();
  const text = { color, fontSize: baseSize, lineHeight: baseSize * 1.45 };

  switch (block.type) {
    case "heading":
      return (
        <RNText
          style={{
            color,
            fontSize: Math.max(baseSize, HEADING_SIZE[block.level]),
            fontWeight: block.level <= 2 ? "700" : "600",
            marginTop: 4,
          }}
        >
          <InlineNodes nodes={parseInline(block.text)} />
        </RNText>
      );
    case "paragraph":
      return (
        <RNText style={text}>
          <InlineNodes nodes={parseInline(block.text)} />
        </RNText>
      );
    case "rule":
      return (
        <View
          style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }}
        />
      );
    case "code":
      return (
        <View style={[styles.code, { backgroundColor: colors.muted }]}>
          <RNText
            style={{ fontFamily: "Menlo", fontSize: fontSize.sm, color }}
          >
            {block.text}
          </RNText>
        </View>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderLeftColor: colors.border }]}>
          {block.blocks.map((b, i) => (
            <BlockView
              key={i}
              block={b}
              baseSize={baseSize}
              color={colors.mutedForeground}
            />
          ))}
        </View>
      );
    case "list": {
      let n = block.start - 1;
      return (
        <View style={{ gap: 4 }}>
          {block.items.map((item, i) => {
            if (item.depth === 0) n++;
            const bullet = block.ordered && item.depth === 0 ? `${n}.` : "•";
            return (
              <View
                key={i}
                style={[styles.listRow, { paddingLeft: item.depth * 16 }]}
              >
                <RNText style={[text, styles.bullet]}>{bullet}</RNText>
                <RNText style={[text, { flex: 1 }]}>
                  <InlineNodes nodes={parseInline(item.text)} />
                </RNText>
              </View>
            );
          })}
        </View>
      );
    }
    case "table":
      return (
        <View style={[styles.table, { borderColor: colors.border }]}>
          {[block.header, ...block.rows].map((row, r) => (
            <View
              key={r}
              style={[
                styles.tableRow,
                {
                  borderTopColor: colors.border,
                  borderTopWidth: r === 0 ? 0 : StyleSheet.hairlineWidth,
                  backgroundColor: r === 0 ? colors.muted : "transparent",
                },
              ]}
            >
              {block.header.map((_, c) => (
                <RNText
                  key={c}
                  style={[
                    text,
                    styles.cell,
                    { fontSize: baseSize - 1 },
                    r === 0 ? { fontWeight: "600" } : null,
                  ]}
                >
                  <InlineNodes nodes={parseInline(row[c] ?? "")} />
                </RNText>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

export function Markdown({
  children,
  size = "sm",
  muted = false,
}: {
  children: string | null | undefined;
  size?: keyof typeof fontSize;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  if (!children?.trim()) return null;
  const blocks = parseBlocks(children);
  const color = muted ? colors.mutedForeground : colors.foreground;
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} baseSize={fontSize[size]} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  code: { borderRadius: 8, padding: 10 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, gap: 6 },
  listRow: { flexDirection: "row", gap: 6 },
  bullet: { minWidth: 14 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row" },
  cell: { flex: 1, paddingHorizontal: 8, paddingVertical: 6 },
});
