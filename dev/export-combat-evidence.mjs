import fs from 'node:fs';
import path from 'node:path';
import {runTrial} from './combat-trial.js';
import {renderPattern} from './pattern-chart.js';
const out=path.resolve('docs/qa-20261026');
fs.mkdirSync(out,{recursive:true});
const summary=[];
for(const id of ['ak47','m4a1','m4a1s']){
  const result=runTrial({id,fps:60});
  const name=id==='m4a1'?'m4a4':id;
  fs.writeFileSync(path.join(out,`${name}-spray.json`),JSON.stringify(result,null,2));
  const keys=['weapon','index','time','seed','yaw','pitch','measuredYaw','measuredPitch','impactX','impactY','error','sourceError'];
  fs.writeFileSync(path.join(out,`${name}-spray.csv`),keys.join(',')+'\n'+result.rows.map(row=>keys.map(key=>row[key]??'').join(',')).join('\n')+'\n');
  fs.writeFileSync(path.join(out,`${name}-spray.svg`),renderPattern(result));
  summary.push({weapon:id,rounds:result.rows.length,seconds:result.rows.at(-1).time,
    implementationRms:result.rms,implementationMax:result.maxError,cs2Rms:result.rmsSource,cs2Max:result.maxSourceError});
}
fs.writeFileSync(path.join(out,'spray-summary.json'),JSON.stringify(summary,null,2));
console.log(summary);
