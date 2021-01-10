RED="\033[1;31m"
GREEN="\033[1;32m"
NC="\033[0m"

## Saving the unstaged changes
git stash save -q --keep-index "current wd"

## Run script file with tests
./run_tests.sh

$RESULT=$?
if [ $RESULT -ne 0 ]; then
	git stash save -q "original index"
	git stash apply -q --index stash@{1}
	git stash drop -q; git stash drop -q 
fi

[ $RESULT -ne 0 ] && exit 1

## Stage files changed or updated by tests 
git add -u
