import Ionicons from '@react-native-vector-icons/ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The five primary sections of PesaTrack.
 *
 * Expo Router maps every file in this folder to a tab. The order of the
 * `Tabs.Screen` entries controls the order of the tab bar.
 */

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type TabBarIconProps = {
  focused: boolean;
  color: ColorValue;
  size: number;
};

/**
 * Builds a `tabBarIcon` renderer for one tab.
 *
 * `color` is typed as `ColorValue` because that is what the tab bar passes
 * (it may be a platform color, not only a hex string). The returned component
 * is a named function so it shows up properly in React DevTools.
 */
function tabIcon(filled: IoniconName, outline: IoniconName) {
  function TabBarIcon({ focused, color, size }: TabBarIconProps) {
    return <Ionicons name={focused ? filled : outline} size={size} color={color} />;
  }

  return TabBarIcon;
}

export default function TabLayout() {
  const theme = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.border,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: tabIcon('swap-horizontal', 'swap-horizontal-outline'),
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{ title: 'Budgets', tabBarIcon: tabIcon('pie-chart', 'pie-chart-outline') }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', tabBarIcon: tabIcon('bar-chart', 'bar-chart-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('settings', 'settings-outline') }}
      />
    </Tabs>
  );
}
