import { Card } from '@/components/card';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { ThemedText } from '@/components/themed-text';

/** Settings — preferences, category management, export and backup. */
export default function SettingsScreen() {
  return (
    <ScreenScaffold title="Settings" subtitle="Preferences, categories, export and backup.">
      <Card title="DATA STORAGE">
        <ThemedText type="small" themeColor="textSecondary">
          PesaTrack keeps your records on this device only. There is no account, no server, and no
          internet connection required. The database is set up in the next milestone.
        </ThemedText>
      </Card>

      <Card title="ABOUT">
        <ThemedText type="default">PesaTrack</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          A personal finance, budgeting and savings tracker made for Kenya. Amounts are shown in
          Kenyan Shillings (KSh).
        </ThemedText>
      </Card>
    </ScreenScaffold>
  );
}
