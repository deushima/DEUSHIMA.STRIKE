export function renderPattern(result){
 const sx=x=>450+x*46,sy=y=>560-y*38;
 const actual=result.rows.map(r=>[r.measuredYaw,r.measuredPitch]),ref=result.rows.map(r=>r.reference).filter(Boolean);
 const points=a=>a.map(([x,y])=>sx(x)+','+sy(y)).join(' ');
 const grid=Array.from({length:17},(_,i)=>i-8).map(x=>`<line x1="${sx(x)}" y1="28" x2="${sx(x)}" y2="560" stroke="#354648"/><text x="${sx(x)}" y="585" fill="#afc3b9" text-anchor="middle">${x}°</text>`).join('')+Array.from({length:14},(_,y)=>`<line x1="82" y1="${sy(y)}" x2="818" y2="${sy(y)}" stroke="#354648"/><text x="64" y="${sy(y)+5}" fill="#afc3b9" text-anchor="end">${y}°</text>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 630" role="img" aria-label="Patrón ${result.id}" style="background:#182224;font:13px system-ui"><rect width="900" height="630" fill="#182224"/>${grid}<polyline points="${points(ref)}" fill="none" stroke="#ffb767" stroke-width="6" opacity=".7"/><polyline points="${points(actual)}" fill="none" stroke="#86efb1" stroke-width="2"/>${actual.map(([x,y],i)=>`<circle cx="${sx(x)}" cy="${sy(y)}" r="3" fill="#86efb1"/>${i%5===0?`<text x="${sx(x)+7}" y="${sy(y)-6}" fill="#e9eee7">${i+1}</text>`:''}`).join('')}<text x="450" y="615" text-anchor="middle" fill="#e9eee7">${result.id} · ${result.rows.length} tiros · error de trayectoria ${result.rmsSource.toFixed(4)}° RMS</text></svg>`;
}
