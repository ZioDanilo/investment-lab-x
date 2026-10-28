export interface RebalanceInput {
  isin: string;
  quantity: number;
  price: number;
  targetWeight: number;
  averageCost: number;
}
export interface RebalanceResult {
  quantities: number[];
  cashRemaining: number;
  transactionCosts: number;
  estimatedTax: number;
  operationCount: number;
  maxDeviation: number;
  squaredDeviation: number;
}

/**
 * Integer-share, long-only rebalancing. Each non-zero net trade reserves EUR 20.
 * Each candidate reserves 26% of positive realized gains on sales using average cost;
 * losses generate no immediate tax credit. Taxes reduce net capital before allocation.
 * Lexicographic objective: minimise worst weight error, then sum of squared
 * weight errors, then operation count. Cash is included in the denominator.
 * Deterministic bounded local search with single moves and sell/buy swaps.
 * It is a heuristic, not a globally certified MIQP optimum.
 */
export function optimizeRebalance(
  items: RebalanceInput[], extraCash: number, fee = 20
): RebalanceResult | null {
  if (!items.length || !Number.isFinite(extraCash)) return null;
  if (items.some(x => !Number.isFinite(x.averageCost) || x.averageCost < 0 ||
    !Number.isFinite(x.price) || x.price <= 0 ||
    !Number.isSafeInteger(x.quantity) || x.quantity < 0 ||
    !Number.isFinite(x.targetWeight) || x.targetWeight < 0)) return null;
  const targetSum = items.reduce((s,x)=>s+x.targetWeight,0);
  if (Math.abs(targetSum-1)>0.001) return null;
  const start = items.map(x=>x.quantity);
  const initialValue = items.reduce((s,x)=>s+x.price*x.quantity,0)+extraCash;
  if (initialValue <= 0) return null;
  const n=items.length;
  const evaluate=(q:number[]):RebalanceResult|null=>{
    let cost=0,operations=0,invested=0,estimatedTax=0;
    for(let i=0;i<n;i++){
      if(!Number.isSafeInteger(q[i])||q[i]<0)return null;
      invested+=q[i]*items[i].price;
      if(q[i]!==start[i]){cost+=fee;operations++;}
      if(q[i]<start[i]){
        const taxableGain=(start[i]-q[i])*Math.max(0,items[i].price-items[i].averageCost);
        estimatedTax+=Math.round(taxableGain*0.26*100)/100;
      }
    }
    const remaining=initialValue-invested-cost-estimatedTax;
    if(remaining < -0.00001)return null;
    const net=initialValue-cost-estimatedTax;
    if(net<=0)return null;
    let maxDeviation=0,squaredDeviation=0;
    for(let i=0;i<n;i++){
      const d=Math.abs(q[i]*items[i].price/net-items[i].targetWeight);
      maxDeviation=Math.max(maxDeviation,d);
      squaredDeviation+=d*d;
    }
    return {quantities:q,cashRemaining:Math.max(0,remaining),transactionCosts:cost,estimatedTax,
      operationCount:operations,maxDeviation,squaredDeviation};
  };
  const better=(a:RebalanceResult,b:RebalanceResult):boolean=>{
    const eps=1e-9;
    if(a.maxDeviation<b.maxDeviation-eps)return true;
    if(a.maxDeviation>b.maxDeviation+eps)return false;
    if(a.squaredDeviation<b.squaredDeviation-eps)return true;
    if(a.squaredDeviation>b.squaredDeviation+eps)return false;
    return a.operationCount<b.operationCount;
  };
  let best=evaluate(start);
  // A withdrawal can make the unchanged portfolio infeasible. Find a
  // partially liquidated seed before considering full liquidation: selling
  // everything may itself be infeasible after capital-gains taxes and fees.
  if (!best && extraCash < 0) {
    const seed = start.slice();
    const order = items.map((item, i) => ({
      i,
      netPerUnit: item.price - 0.26 * Math.max(0, item.price - item.averageCost),
      taxRate: Math.max(0, item.price - item.averageCost) * 0.26 / item.price
    })).filter(x => start[x.i] > 0)
      .sort((a,b) => a.taxRate - b.taxRate || b.netPerUnit - a.netPerUnit);
    let deficit = items.reduce((sum, item) => sum + item.price * item.quantity, 0) - initialValue;
    for (const entry of order) {
      if (deficit <= 0) break;
      const i = entry.i;
      const netPerUnit = entry.netPerUnit;
      const needed = Math.max(0, deficit + fee);
      const sold = Math.min(seed[i], Math.ceil((needed + 0.02) / netPerUnit));
      if (sold <= 0) continue;
      seed[i] -= sold;
      const taxPerUnit = Math.max(0, items[i].price - items[i].averageCost) * 0.26;
      deficit -= sold * (items[i].price - taxPerUnit) - fee;
    }
    // Rounding can leave a small shortfall; sell additional shares until
    // the same feasibility check used by the optimizer succeeds.
    best = evaluate(seed);
    if (!best) {
      for (const entry of order) {
        while (!best && seed[entry.i] > 0) {
          seed[entry.i]--;
          best = evaluate(seed);
        }
        if (best) break;
      }
    }
  }
  if (!best) best = evaluate(items.map(() => 0));
  if (!best) return null;
  // First produce a feasible seed by selling excess positions, then adding
  // underweights with the resulting liquidity.
  let q=start.slice();
  for(let i=0;i<n;i++){
    const desired=Math.max(0,Math.round(items[i].targetWeight*initialValue/items[i].price));
    if(desired<q[i])q[i]=desired;
  }
  let candidate=evaluate(q);
  if(candidate && better(candidate,best)){best=candidate;}
  else if(!candidate){q=start.slice();}
  // Greedy single and paired moves. Paired moves can finance purchases by
  // selling an overweight holding even when cash is initially exhausted.
  const limit=Math.min(300,Math.max(40,n*18));
  for(let iteration=0;iteration<limit;iteration++){
    let next: RebalanceResult = best;
    const current=best.quantities;
    const consider=(trial:number[])=>{
      const result=evaluate(trial);
      if(result && better(result,next))next=result;
    };
    const maxBlock=Math.max(1,Math.ceil(initialValue/Math.max(1,...items.map(x=>x.price))/10));
    for(let i=0;i<n;i++){
      const ideal=items[i].targetWeight*(initialValue-best.transactionCosts-best.estimatedTax)/items[i].price;
      const steps=new Set([1,2,5,10,maxBlock,Math.abs(Math.round(ideal)-current[i])]);
      for(const step of steps){
        if(step<=0)continue;
        for(const sign of [-1,1]){
          const trial=current.slice();trial[i]+=sign*step;consider(trial);
        }
      }
    }
    // Price-aware swaps: sell ETF i, use proceeds to buy ETF j.
    for(let i=0;i<n;i++){
      if(current[i]<=0)continue;
      for(let j=0;j<n;j++){
        if(i===j)continue;
        const sellSteps=new Set([1,Math.min(current[i],5),
          Math.min(current[i],Math.max(1,Math.ceil(current[i]*.2)))]);
        for(const sold of sellSteps){
          if(sold<=0)continue;
          const incrementalTax=Math.max(0,sold)*Math.max(0,items[i].price-items[i].averageCost)*0.26;
          const funds=sold*items[i].price+best.cashRemaining-incrementalTax-
            (current[i]===start[i]?fee:0)-(current[j]===start[j]?fee:0);
          const buy=Math.max(0,Math.floor(funds/items[j].price));
          for(const bought of new Set([1,buy,Math.max(1,Math.round(buy*.5))])){
            const trial=current.slice();trial[i]-=sold;trial[j]+=bought;consider(trial);
          }
        }
      }
    }
    if(next===best)break;
    best=next;
  }
  return best;
}
