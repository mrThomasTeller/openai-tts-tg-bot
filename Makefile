all: deploy

build:
	docker compose -f docker-compose.yml build

deploy:
	make build && make start

start-attached:
	docker compose -f docker-compose.yml up

start:
	docker compose -f docker-compose.yml up --detach && docker system prune -f

stop:
	docker compose stop

bash:
	docker exec -it tts-bot bash

log:
	docker compose logs -f --timestamps
 
docker-prune-unused:
	docker system prune -a

docker-disk-space:
	docker system df

upgrade-ubuntu:
	sudo apt update
	sudo apt upgrade
	sudo reboot
