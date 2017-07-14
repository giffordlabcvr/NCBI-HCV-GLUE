function syncCurated() {
	glue.log("INFO", "Importing source "+source.name+" from file system...");
	var importResult = glue.command(["import", "source", "--batchSize", "1000", source.path+"/"+source.name], {convertTableToObjects:true});
	glue.log("INFO", "Imported "+importResult.length+" sequences");
	glue.log("INFO", "Synchronizing source "+source.name+" with NCBI...");
	glue.inMode("module/"+modules.ncbiImporter, function() {
		var syncResult = glue.command(["sync", "--detailed"], {convertTableToObjects:true});
		glue.log("FINEST", "NCBI syncronization report", syncResult);
		glue.log("INFO", "Synchronization complete");
	});
	glue.log("INFO", "Exporting source "+source.name+" to file system...");
	glue.command(["export", "source", "--sync", "--parentDir", source.path, source.name]);
}

function placeCurated() {
	glue.log("INFO", "Deleting files in placement path "+placement.path);
	var placementPathFiles = glue.command(["file-util", "list-files", "--directory", placement.path], {convertTableToObjects:true});
	_.each(placementPathFiles, function(placementPathFile) {
		glue.command(["file-util", "delete-file", placement.path+"/"+placementPathFile.fileName]);
	});
	glue.log("INFO", "Deleted "+placementPathFiles.length+" files");
	glue.log("INFO", "Counting sequences in source "+source.name);
	var numSequences = glue.command(["count", "sequence", "--whereClause", "source.name = '"+source.name+"'"]).countResult.count;
	glue.log("INFO", "Found "+numSequences+" sequences in source "+source.name);
	var batchSize = 100;
	var offset = 0;
	var fileSuffix = 1;
	while(offset < numSequences) {
		glue.log("INFO", "Placing "+batchSize+" sequences starting at offset "+offset);
		glue.inMode("module/"+modules.placer, function() {
			var outputFile = placement.path + "/" + placement.prefix + fileSuffix + ".xml";
			glue.command(["place", "sequence", 
                           "--whereClause", "source.name = '"+source.name+"'",
                           "--pageSize", batchSize, "--fetchLimit", batchSize, "--fetchOffset", offset, 
                           "--outputFile", outputFile]);
		});
		offset += batchSize;
		fileSuffix++;
	}
}

function genotypeCurated() {
	var placementPathFiles = glue.command(["file-util", "list-files", "--directory", placement.path], {convertTableToObjects:true});
	_.each(placementPathFiles, function(placementPathFile) {
		var batchGenotyperResults;
		glue.inMode("module/"+modules.genotyper, function() {
			batchGenotyperResults = glue.command(
					["genotype", "placer-result", 
					 "--fileName", placement.path+"/"+placementPathFile.fileName, 
					 "--detailLevel", "HIGH"], 
					{convertTableToObjects:true});
		});
		_.each(batchGenotyperResults, function(genotyperResult) {
			glue.inMode("sequence/"+genotyperResult.queryName, function() {
				var epaGenotype = genotyperResult.genotypeFinalClade;
				if(epaGenotype) {
					glue.command(["set", "field", "--noCommit", "epa_genotype_final_clade", epaGenotype]);
					var gtRegex = /AL_([0-9]+)/;
					var gtMatch = gtRegex.exec(epaGenotype);
					if(gtMatch) {
						glue.command(["set", "field", "--noCommit", "epa_genotype", gtMatch[1]]);
					}
				}
				var epaSubtype = genotyperResult.subtypeFinalClade;
				if(epaSubtype) {
					glue.command(["set", "field", "--noCommit", "epa_subtype_final_clade", epaSubtype]);
					var stRegex = /AL_([0-9]+)([a-z]+)/;
					var stMatch = stRegex.exec(epaSubtype);
					if(stMatch) {
						glue.command(["set", "field", "--noCommit", "epa_subtype", stMatch[2]]);
					}
				}
			});
		});
		glue.command("commit");
	});
	
}