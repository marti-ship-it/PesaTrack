import type Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';

/**
 * The name of an Ionicon.
 *
 * Category icons are stored in the database as plain strings, so the UI has to
 * accept a value it cannot verify at compile time. Exporting the exact prop type
 * here keeps the single necessary cast in one obvious place instead of scattering
 * `as any` across the components.
 */
export type IoniconName = ComponentProps<typeof Ionicons>['name'];
