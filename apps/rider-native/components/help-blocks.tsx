/**
 * Renders help-article blocks (parsed server-side from the article markdown)
 * as native Text. `help:<slug>` links open another article in-app; web links
 * open in the browser.
 */
import { View, Text, StyleSheet, Linking } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '../lib/api';
import type { Block, HelpLang, Inline } from '../lib/api-help';
import { colors, spacing, radius, font } from '../lib/theme';

function openLink(href: string, lang: HelpLang) {
  if (href.startsWith('help:')) {
    router.push({ pathname: '/help-article', params: { slug: href.slice(5), lang } });
  } else if (href.startsWith('/')) {
    Linking.openURL(`${API_BASE}${href}`).catch(() => {});
  } else {
    Linking.openURL(href).catch(() => {});
  }
}

function Inlines({ inline, lang }: { inline: Inline[]; lang: HelpLang }) {
  return (
    <>
      {inline.map((i, idx) => {
        switch (i.t) {
          case 'bold':
            return <Text key={idx} style={styles.bold}>{i.v}</Text>;
          case 'italic':
            return <Text key={idx} style={styles.italic}>{i.v}</Text>;
          case 'code':
            return <Text key={idx} style={styles.code}>{i.v}</Text>;
          case 'link':
            return (
              <Text key={idx} style={styles.link} onPress={() => openLink(i.href, lang)} accessibilityRole="link">
                {i.v}
              </Text>
            );
          default:
            return <Text key={idx}>{i.v}</Text>;
        }
      })}
    </>
  );
}

export function HelpBlocks({ blocks, lang }: { blocks: Block[]; lang: HelpLang }) {
  return (
    <View style={styles.wrap}>
      {blocks.map((b, idx) => {
        switch (b.type) {
          case 'h2':
            return <Text key={idx} style={styles.h2}><Inlines inline={b.inline} lang={lang} /></Text>;
          case 'h3':
            return <Text key={idx} style={styles.h3}><Inlines inline={b.inline} lang={lang} /></Text>;
          case 'note':
            return (
              <View key={idx} style={styles.note}>
                <Ionicons name="information-circle" size={18} color={colors.primary} />
                <Text style={[styles.p, styles.noteText]}><Inlines inline={b.inline} lang={lang} /></Text>
              </View>
            );
          case 'ul':
          case 'ol':
            return (
              <View key={idx} style={styles.list}>
                {b.items.map((it, j) => (
                  <View key={j} style={styles.li}>
                    <Text style={styles.bullet}>{b.type === 'ol' ? `${j + 1}.` : '•'}</Text>
                    <Text style={[styles.p, styles.liText]}><Inlines inline={it} lang={lang} /></Text>
                  </View>
                ))}
              </View>
            );
          default:
            return <Text key={idx} style={styles.p}><Inlines inline={b.inline} lang={lang} /></Text>;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  p: { fontSize: font.size.md, lineHeight: 23, color: colors.text },
  h2: { fontSize: font.size.lg, fontWeight: font.weight.bold, color: colors.text, marginTop: spacing.sm },
  h3: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  bold: { fontWeight: font.weight.bold },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: 'monospace', backgroundColor: colors.primarySoft },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  noteText: { flex: 1 },
  list: { gap: spacing.xs },
  li: { flexDirection: 'row', gap: spacing.sm },
  bullet: { fontSize: font.size.md, lineHeight: 23, color: colors.textMuted, minWidth: 18 },
  liText: { flex: 1 },
});
