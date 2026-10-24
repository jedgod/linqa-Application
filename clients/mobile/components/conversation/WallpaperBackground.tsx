import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { LinearGradient } from "../LinearGradient";
import type { Wallpaper } from "../../services/wallpapers";

/** Faint line doodles over the colour. Faint on purpose: message text sits on top and must stay readable. */
function Doodle({ dark }: { dark: boolean }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" pointerEvents="none">
      <G stroke={dark ? "#FFFFFF" : "#000000"} strokeWidth="1.2" fill="none" opacity={dark ? 0.05 : 0.07} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M30,50 C45,35 55,60 70,45 S95,35 85,70 M40,110 A12,12 0 1,1 64,120" />
        <Path d="M280,60 L305,85 L330,60 L305,35 Z M160,40 Q185,20 210,50 T260,30" />
        <Path d="M60,220 C50,245 85,265 65,295 M220,190 A20,20 0 1,0 250,220" />
        <Path d="M110,380 C135,345 175,345 185,395 S145,445 110,380 Z" />
        <Path d="M50,540 L95,540 L72,575 Z M240,550 Q265,505 290,550 T340,550" />
        <Path d="M120,710 C145,735 180,680 200,725 M290,690 A15,15 0 1,0 315,690" />
      </G>
    </Svg>
  );
}

/**
 * Fills its parent with the wallpaper: a solid, or the repo's gradient stand-in for multi-stop ones, plus the doodle if
 * it has one. `dim` (0 to 1) lays a black mask over it so messages stay readable on busy or bright wallpapers.
 */
export function WallpaperBackground({ wallpaper, dim = 0, style, testID }: { wallpaper: Wallpaper; dim?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} accessibilityLabel={testID ? `Wallpaper: ${wallpaper.name}` : undefined} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: wallpaper.bgColors[0] }, style]}>
      {wallpaper.bgColors.length > 1 ? <LinearGradient colors={wallpaper.bgColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {wallpaper.hasDoodle ? <Doodle dark={wallpaper.isDark} /> : null}
      {dim > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000000", opacity: dim }]} /> : null}
    </View>
  );
}
