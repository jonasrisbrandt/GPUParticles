// Finite viewing window for the scale-model preset; t=1 is never evaluated.
export const COLLAPSE_DURATION=24;
export const COLLAPSE_END=.96;
export function collapseState(seconds){
  const progress=Math.max(0,Math.min(1,seconds/COLLAPSE_DURATION));
  const t=COLLAPSE_END*progress,tau=1-t;
  return {progress,t,tau,guideRadius:tau**.42,guideHeight:1+1.1*progress,done:progress===1};
}
