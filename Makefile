all: deploy

deploy:
	make build && make start

start-attached: .remove-app-container
	docker compose -f docker-compose.yml up

start: .remove-app-container
	docker compose -f docker-compose.yml up --detach && docker system prune -f

stop:
	docker compose stop

bash:
	docker exec -it ms-robots-app bash

app-log:
	docker compose logs app -f --timestamps

all-logs:
	docker compose logs -f --timestamps
 
docker-prune-unused:
	docker system prune -a

docker-disk-space:
	docker system df

upgrade-ubuntu:
	sudo apt update
	sudo apt upgrade
	sudo reboot
