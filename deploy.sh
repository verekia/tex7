docker buildx build --platform linux/arm64 --load -t verekia/tex7 .
docker save verekia/tex7 | gzip > /tmp/tex7.tar.gz
scp /tmp/tex7.tar.gz midgar:/tmp/
ssh midgar docker load --input /tmp/tex7.tar.gz
ssh midgar docker compose up -d tex7
