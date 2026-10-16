import { EmptyState } from '@/components/empty-state';
import { ScreenScaffold } from '@/components/screen-scaffold';

/** Reports — charts, monthly comparisons and data-driven insights. */
export default function ReportsScreen() {
  return (
    <ScreenScaffold title="Reports" subtitle="Where your money comes from and where it goes.">
      <EmptyState
        title="Record transactions to compare monthly spending"
        message="Category breakdowns, monthly comparisons and need-versus-want analysis are calculated from your own records, so they need at least one month of data."
      />
    </ScreenScaffold>
  );
}
