#!/bin/bash
eval $(docker-machine env ntag.fr)
docker-compose -f docker-compose.base.yml -f docker-compose.prod.yml -p ntag/lyrics.ovh up -d --build