---
id: gpu-swarm
name: GPU swarm
short: GPU
cat: swarm
what: batch of jobs on cloud GPUs
art: .c.c.c.c cccccccc ckkkkkkc ckgggkkc ckgggkkc ckkkkkkc cccccccc .c.c.c.c
---
Cloud GPU swarm: {task}. First plan the jobs, the GPU type and count, the hours, a spend cap and a terminate-by time, and do a local dry run. Quote the hourly price and the worst-case total, then wait for my typed go before creating any cloud resource. Save every output off the machine, terminate every machine you start when the jobs end or at the deadline and read back that it is gone, and reply with one report: what ran, what it cost, and a source for each claim.
