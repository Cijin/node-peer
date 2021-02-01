#!/bin/sh
RED="\033[1;31m"
GREEN="\033[1;32m"
NC="\033[0m"
FILES_PATTERN='\.(ts)(\..+)?$'
FORBIDDEN="console.log"

## Tests start here
echo "${GREEN}Checking for Linting errors:${NC}"
npm run lint || exit 1

echo "${GREEN}Checking for type errors:${NC}"
npm run type-check || exit 1

echo "${GREEN}Running Tests:${NC}"
npm run test || exit 1

echo "${GREEN}Looking for forbidden references:${NC}"
git diff --cached --name-only | \
  grep -E $FILES_PATTERN | \
  xargs grep --color --with-filename -n $FORBIDDEN &&
  echo "${RED}COMMIT REJECTED Found '$FORBIDDEN' references. Please remove them before commiting${NC}" && exit 1 
  echo "None Found 🎉 😉"
exit 0
