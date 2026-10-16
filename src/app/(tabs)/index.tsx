import { EmptyState } from '@/components/empty-state';
import { ScreenScaffold } from '@/components/screen-scaffold';

/**
 * Home — the main dashboard.
 *
 * The real dashboard (income, expenses, savings, available balance, budget
 * remaining, safe-to-spend) is built in the dashboard milestone. For now this
 * screen shows the honest empty state, because no transaction can be recorded
 * yet.
 */
export default function HomeScreen() {
  return (
    <ScreenScaffold title="Home" subtitle="Your monthly dashboard will live here.">
      <EmptyState
        title="Your financial journey starts here"
        message="Once you can record transactions, this screen will calculate your available balance, monthly totals and safe-to-spend amount from your real data."
      />
    </ScreenScaffold>
  );
}
