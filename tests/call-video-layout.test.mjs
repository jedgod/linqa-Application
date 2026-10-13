import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../clients/mobile/node_modules/typescript/lib/typescript.js';

const module={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../clients/mobile/components/calls/video-layout.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports});
const {videoTileSize,clampVideoPosition,initialVideoPosition}=module.exports;

test('video tiles fit narrow phones, portrait screens and shallow landscape stages',()=>{
 for(const bounds of [{width:320,height:280},{width:360,height:440},{width:780,height:140},{width:200,height:60}]){
  const size=videoTileSize(bounds);const position=initialVideoPosition(bounds,size);
  assert.ok(size>0&&size<=144&&size<=Math.min(bounds.width,bounds.height));
  assert.ok(position.x>=0&&position.y>=0);
  assert.ok(position.x+size<=bounds.width&&position.y+size<=bounds.height);
 }
});
test('dragging cannot put the small video underneath the header or outside the stage',()=>{
 const bounds={width:360,height:440};const size=videoTileSize(bounds);
 const top=clampVideoPosition({x:-1000,y:-1000},bounds,size);
 const bottom=clampVideoPosition({x:1000,y:1000},bounds,size);
 assert.equal(top.x,8);assert.equal(top.y,8);
 assert.equal(bottom.x+size,352);assert.equal(bottom.y+size,432);
});
test('a dragged tile is brought back into bounds after rotation',()=>{
 const portrait={width:360,height:440};const prior=initialVideoPosition(portrait,videoTileSize(portrait));
 const landscape={width:780,height:140};const size=videoTileSize(landscape);
 const position=clampVideoPosition(prior,landscape,size);
 assert.ok(position.y+size<=landscape.height-8);
 assert.ok(position.x+size<=landscape.width-8);
});

test('a single tap does not swap videos, a double tap swaps both ways, and accessibility can activate the swap',()=>{
 let now=1000;let swaps=0;
 const react={createElement:(type,props,...children)=>({type,props,children}),useRef:value=>({current:value}),useEffect:fn=>fn()};
 const native={Pressable:'Pressable',StyleSheet:{create:value=>value}};
 const component={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(new URL('../clients/mobile/components/calls/FloatingCallVideo.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module:component,exports:component.exports,Date:{now:()=>now},require:name=>name==='react'?react:name==='react-native'?native:module.exports});
 const view=component.exports.DoubleTapVideo({onSwap:()=>swaps++,children:null});
 view.props.onPress();assert.equal(swaps,0);
 now+=250;view.props.onPress();assert.equal(swaps,1);
 now+=1000;view.props.onPress();now+=400;view.props.onPress();assert.equal(swaps,1);
 now+=200;view.props.onPress();assert.equal(swaps,2);
 view.props.onAccessibilityAction();assert.equal(swaps,3);
});
