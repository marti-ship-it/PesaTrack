import { EmptyState } from '@/components/empty-state';
import { ScreenScaffold } from '@/components/screen-scaffold';

/** Budgets — monthly spending limits per expense category. */
export default function BudgetsScreen() {
  return (
    <ScreenScaffold title="Budgets" subtitle="Monthly limits for your spending categories.">
      <EmptyState
        title="You haven't set a budget for this month yet"
        message="Budgets apply to expenses only. Once you set limits, this screen will compare budget against actual spending for every category."
      />
    </ScreenScaffold>
  );
}
