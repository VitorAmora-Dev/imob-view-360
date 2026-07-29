{ pkgs ? import <nixpkgs> {} }:

let
  dbStart = pkgs.writeShellScriptBin "db-start" ''
    set -e
    export PGDATA="''${PGDATA:-$PWD/.postgres}"
    export PATH="${pkgs.postgresql_16}/bin:$PATH"

    if [ ! -d "$PGDATA" ]; then
      echo "  Inicializando cluster PostgreSQL em $PGDATA..."
      initdb --username=postgres --auth=trust --no-instructions --encoding=UTF8
      echo "listen_addresses = '127.0.0.1'"      >> "$PGDATA/postgresql.conf"
      echo "port = 5432"                         >> "$PGDATA/postgresql.conf"
      echo "unix_socket_directories = '$PGDATA'" >> "$PGDATA/postgresql.conf"
      echo "host all all 127.0.0.1/32 trust"     >> "$PGDATA/pg_hba.conf"
    fi

    pg_ctl start -l "$PGDATA/pg.log" -w
    echo "  Aguardando PostgreSQL..."
    until pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done
    createdb -h 127.0.0.1 -U postgres property-360 2>/dev/null \
      && echo "  Banco 'property-360' criado." \
      || echo "  Banco 'property-360' já existe."
  '';

  dbStop = pkgs.writeShellScriptBin "db-stop" ''
    export PGDATA="''${PGDATA:-$PWD/.postgres}"
    export PATH="${pkgs.postgresql_16}/bin:$PATH"
    pg_ctl stop -w
  '';

  dbLogs = pkgs.writeShellScriptBin "db-logs" ''
    tail -f "''${PGDATA:-$PWD/.postgres}/pg.log"
  '';

in pkgs.mkShell {
  buildInputs = [
    pkgs.postgresql_16
    pkgs.nodejs_22
    pkgs.yarn
    pkgs.prisma-engines
    pkgs.openssl
    dbStart
    dbStop
    dbLogs
  ];

  shellHook = ''
    # Prisma no NixOS: usa engines do nixpkgs em vez de baixar binários (não existem para "nixos")
    export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"
    export PRISMA_QUERY_ENGINE_BINARY="${pkgs.prisma-engines}/bin/query-engine"
    export PRISMA_QUERY_ENGINE_LIBRARY="${pkgs.prisma-engines}/lib/libquery_engine.node"

    export PGDATA="$PWD/.postgres"
    export PGHOST="127.0.0.1"
    export PGPORT="5432"
    export PGUSER="postgres"
    export PGDATABASE="property-360"

    if [ ! -f .env ]; then
      cp .env.example .env
      echo "  .env criado a partir de .env.example"
    fi

    set -a
    source .env
    set +a

    echo ""
    echo "  Comandos disponíveis:"
    echo "    db-start   — inicia o PostgreSQL local"
    echo "    db-stop    — para o PostgreSQL"
    echo "    db-logs    — mostra os logs do PG"
    echo ""
    echo "  Setup inicial (rodar uma vez):"
    echo "    db-start && yarn install && npx prisma migrate deploy && yarn seed"
    echo ""
    echo "  Desenvolvimento:"
    echo "    db-start && yarn start:dev"
    echo ""
  '';
}
