// Icon names used by the protected-photo screens, drawn with the app's Ionicons.

import React from 'react';
import { Ionicons } from '@expo/vector-icons';

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const make = (name: React.ComponentProps<typeof Ionicons>['name']) =>
  function Icon({ size = 22, color }: IconProps) {
    return <Ionicons name={name} size={size} color={color} />;
  };

export const Camera = make('camera-outline');
export const Eye = make('eye-outline');
export const EyeOff = make('eye-off-outline');
export const Lock = make('lock-closed-outline');
export const Timer = make('timer-outline');
export const Clock = make('time-outline');
export const X = make('close-outline');
export const ShieldAlert = make('alert-circle-outline');
export const ShieldCheck = make('shield-checkmark-outline');
export const ImagePlus = make('image-outline');
