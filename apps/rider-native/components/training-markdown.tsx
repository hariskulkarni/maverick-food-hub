/** Renders a training lesson's markdown subset with native Text/Image. */
import { Fragment } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { parseMarkdown, type InlineSpan } from '../lib/training-markdown';
import { colors, font, radius, spacing } from '../lib/theme';

function Inline({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === 'bold') return <Text key={i} style={styles.bold}>{s.v}</Text>;
        if (s.t === 'italic') return <Text key={i} style={styles.italic}>{s.v}</Text>;
        if (s.t === 'link') {
          return (
            <Text key={i} style={styles.link} onPress={() => Linking.openURL(s.href).catch(() => {})}>
              {s.v}
            </Text>
          );
        }
        return <Fragment key={i}>{s.v}</Fragment>;
      })}
    </>
  );
}

export function TrainingMarkdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return <Text key={i} style={b.level === 2 ? styles.h2 : styles.h3}>{b.text}</Text>;
        }
        if (b.type === 'paragraph') {
          return <Text key={i} style={styles.para}><Inline spans={b.spans} /></Text>;
        }
        if (b.type === 'image') {
          return <Image key={i} source={{ uri: b.src }} style={styles.image} resizeMode="cover" accessibilityLabel={b.alt} />;
        }
        return (
          <View key={i} style={styles.list}>
            {b.items.map((it, j) => (
              <View key={j} style={styles.listRow}>
                <Text style={styles.marker}>{b.ordered ? `${j + 1}.` : '•'}</Text>
                <Text style={styles.listText}><Inline spans={it} /></Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  h2: { fontSize: font.size.lg, fontWeight: font.weight.bold, color: colors.text, marginTop: spacing.sm },
  h3: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text, marginTop: spacing.xs },
  para: { fontSize: font.size.md, lineHeight: 24, color: colors.text },
  bold: { fontWeight: font.weight.bold },
  italic: { fontStyle: 'italic' },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.border },
  list: { gap: 6 },
  listRow: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.sm },
  marker: { fontSize: font.size.md, lineHeight: 24, color: colors.primary, minWidth: 18, fontWeight: font.weight.bold },
  listText: { flex: 1, fontSize: font.size.md, lineHeight: 24, color: colors.text },
});
