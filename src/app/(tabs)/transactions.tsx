import { EmptyState } from '@/components/empty-state';
import { ScreenScaffold } from '@/components/screen-scaffold';

/** Transactions — the searchable history of every recorded entry. */
export default function TransactionsScreen() {
  return (
    <ScreenScaffold title="Transactions" subtitle="Every income, expense and saving you record.">
      <EmptyState
        title="No transactions yet"
        message="Recorded entries will appear here, newest first, with search and filters for type, category, month and amount."
      />
    </ScreenScaffold>
  );
}
