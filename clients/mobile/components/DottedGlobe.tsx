import { memo } from "react";
import Svg, { Circle, Defs, G, Path, Pattern, RadialGradient, Stop } from "react-native-svg";

type DottedGlobeProps = { size: number };

/** Local vector artwork so the first-run screen never depends on the network. */
function DottedGlobeComponent({ size }: DottedGlobeProps) {
  return (
    <Svg accessible={false} width={size} height={size} viewBox="0 0 420 420" preserveAspectRatio="xMidYMid meet">
      <Defs>
        <RadialGradient id="globeGlow" cx="50%" cy="43%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor="#7770FF" stopOpacity={0.35} />
          <Stop offset="65%" stopColor="#3430C4" stopOpacity={0.18} />
          <Stop offset="100%" stopColor="#14106A" stopOpacity={0.04} />
        </RadialGradient>
        <Pattern id="dots" width="13" height="13" patternUnits="userSpaceOnUse">
          <Circle cx="6.5" cy="6.5" r="3.15" fill="#EEE9FF" opacity={0.96} />
        </Pattern>
        <Pattern id="edgeDots" width="13" height="13" patternUnits="userSpaceOnUse">
          <Circle cx="6.5" cy="6.5" r="2.8" fill="#D2CCFF" opacity={0.72} />
        </Pattern>
      </Defs>

      <Circle cx="210" cy="210" r="191" fill="url(#globeGlow)" />
      <Circle cx="210" cy="210" r="190" fill="none" stroke="#B7AEFF" strokeOpacity={0.12} />
      <G opacity={0.34}>
        <Path d="M45 110C9 176 14 282 73 344" fill="none" stroke="#B8B0FF" strokeWidth="2" strokeDasharray="1 11" strokeLinecap="round" />
        <Path d="M371 89C408 166 405 268 356 342" fill="none" stroke="#B8B0FF" strokeWidth="2" strokeDasharray="1 11" strokeLinecap="round" />
      </G>

      <Path d="M57 96C76 72 101 57 127 56C142 55 160 61 168 73C153 79 144 88 132 96C120 104 113 116 105 130C96 146 83 151 76 161C67 175 65 191 59 207C52 222 44 239 48 255C52 271 63 285 72 298C80 309 82 323 88 335C97 350 111 359 119 374C105 369 92 360 80 348C63 331 51 310 44 288C36 262 30 235 32 208C34 170 40 131 57 96Z" fill="url(#edgeDots)" />
      <Path d="M98 202C113 211 124 219 134 231C141 240 149 249 158 254C150 258 140 256 132 252C121 246 112 239 103 230C96 223 91 214 98 202Z" fill="url(#dots)" />
      <Path d="M134 241C154 238 177 246 188 262C198 277 192 294 183 308C176 321 172 338 166 353C160 369 153 382 143 393C136 382 132 368 127 355C119 337 112 321 107 303C103 287 103 270 111 257C117 248 123 244 134 241Z" fill="url(#dots)" />
      <Path d="M187 76C207 65 229 61 250 64C266 66 279 76 293 80C307 84 325 79 340 84C355 88 368 100 376 115C382 128 385 143 381 157C376 172 367 184 355 194C345 202 332 207 321 213C310 220 302 230 293 240C284 249 272 253 260 250C250 247 243 239 233 235C221 230 207 232 197 224C189 217 185 205 179 195C174 186 167 177 168 166C170 151 181 142 187 132C193 121 190 110 183 101C178 92 179 82 187 76Z" fill="url(#dots)" />
      <Path d="M180 111C188 102 199 97 207 101C213 104 215 111 220 115C224 119 231 117 234 123C236 129 229 134 224 139C217 145 213 151 207 156C199 162 189 161 184 155C178 148 176 139 173 131C171 123 174 116 180 111Z" fill="url(#dots)" />
      <Path d="M197 161C217 153 239 154 256 165C270 173 279 187 284 202C289 219 288 238 281 254C274 268 267 282 262 296C256 314 252 334 243 351C235 366 225 380 214 393C205 386 200 375 194 365C184 349 177 333 172 315C168 298 159 285 153 270C146 253 146 235 151 218C156 201 166 183 180 171C186 166 190 163 197 161Z" fill="url(#dots)" />
      <Path d="M151 194C170 183 194 178 218 181C242 184 264 193 284 205L277 238C257 228 237 223 215 222C194 221 171 223 151 232Z" fill="url(#dots)" />
      <Path d="M275 304C280 312 281 326 276 339C273 347 268 353 264 360C260 353 260 344 262 335C264 324 268 313 275 304Z" fill="url(#dots)" />
      <Path d="M104 55C118 44 137 39 153 44C163 47 170 53 175 61C165 67 153 70 141 68C129 67 116 64 104 55Z" fill="url(#edgeDots)" />
      <G fill="#EEE9FF" opacity={0.9}>
        <Circle cx="163" cy="130" r="3.2" /><Circle cx="175" cy="137" r="3" /><Circle cx="188" cy="145" r="3.1" />
        <Circle cx="301" cy="250" r="3" /><Circle cx="316" cy="243" r="2.8" /><Circle cx="329" cy="232" r="2.9" />
      </G>
    </Svg>
  );
}

export const DottedGlobe = memo(DottedGlobeComponent);
